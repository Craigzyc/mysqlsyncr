// Server-wide health checks from SHOW GLOBAL STATUS / VARIABLES (read-only).
// Counters are cumulative since server start, so ratios describe lifetime behavior;
// "current"/"pending" gauges describe right now.

const num = (map, key) => {
    const value = Number(map[key.toLowerCase()]);
    return Number.isFinite(value) ? value : null;
};
const pct = value => `${(value * 100).toFixed(1)}%`;
const worst = checks => checks.some(c => c.status === 'critical') ? 'critical' : checks.some(c => c.status === 'warning') ? 'warning' : 'ok';

function toMap(rows) {
    const map = {};
    for (const row of rows) map[String(row.Variable_name ?? row.VARIABLE_NAME).toLowerCase()] = row.Value ?? row.VARIABLE_VALUE;
    return map;
}

export function evaluateLockContention(status, lockWaitRows = []) {
    const checks = [];
    const current = num(status, 'Innodb_row_lock_current_waits');
    if (current !== null) checks.push({ status: current > 5 ? 'critical' : current > 0 ? 'warning' : 'ok', message: `${current} transaction(s) currently waiting on InnoDB row locks.` });
    const avg = num(status, 'Innodb_row_lock_time_avg');
    if (avg !== null) checks.push({ status: avg > 1000 ? 'critical' : avg > 100 ? 'warning' : 'ok', message: `Average InnoDB row lock wait: ${avg} ms (${num(status, 'Innodb_row_lock_waits') ?? 0} waits since start).` });
    const waited = num(status, 'Table_locks_waited'), immediate = num(status, 'Table_locks_immediate');
    if (waited !== null && immediate) {
        const ratio = waited / (waited + immediate);
        checks.push({ status: ratio > 0.05 ? 'critical' : ratio > 0.01 ? 'warning' : 'ok', message: `${pct(ratio)} of table lock requests had to wait (MyISAM/table-level locks).` });
    }
    if (lockWaitRows.length) checks.push({ status: 'critical', message: `${lockWaitRows.length} blocking transaction(s) exceed the duration threshold right now. See Blocking transactions.` });
    return checks;
}

export function evaluateDiskIo(status) {
    const checks = [];
    const pending = ['Innodb_data_pending_reads', 'Innodb_data_pending_writes', 'Innodb_data_pending_fsyncs', 'Innodb_os_log_pending_fsyncs']
        .reduce((sum, key) => sum + (num(status, key) ?? 0), 0);
    checks.push({ status: pending > 10 ? 'critical' : pending > 0 ? 'warning' : 'ok', message: `${pending} InnoDB read/write/fsync operation(s) pending right now.` });
    const logWaits = num(status, 'Innodb_log_waits');
    if (logWaits !== null) checks.push({ status: logWaits > 0 ? 'warning' : 'ok', message: `${logWaits} redo log wait(s) since start${logWaits > 0 ? '; consider a larger innodb_log_buffer_size' : ''}.` });
    const tmp = num(status, 'Created_tmp_tables'), disk = num(status, 'Created_tmp_disk_tables');
    if (tmp && disk !== null) {
        const ratio = disk / tmp;
        checks.push({ status: ratio > 0.25 ? 'critical' : ratio > 0.1 ? 'warning' : 'ok', message: `${pct(ratio)} of temporary tables spilled to disk.` });
    }
    return checks;
}

export function evaluateMemory(status, variables) {
    const checks = [];
    const requests = num(status, 'Innodb_buffer_pool_read_requests'), reads = num(status, 'Innodb_buffer_pool_reads');
    if (requests) {
        const hit = 1 - (reads ?? 0) / requests;
        checks.push({ status: hit < 0.95 ? 'critical' : hit < 0.99 ? 'warning' : 'ok', message: `Buffer pool hit ratio ${pct(hit)} (reads served from memory).` });
    }
    const waitFree = num(status, 'Innodb_buffer_pool_wait_free');
    if (waitFree !== null) checks.push({ status: waitFree > 0 ? 'warning' : 'ok', message: `${waitFree} wait(s) for a free buffer pool page since start.` });
    const total = num(status, 'Innodb_buffer_pool_pages_total'), dirty = num(status, 'Innodb_buffer_pool_pages_dirty');
    if (total && dirty !== null) {
        const ratio = dirty / total;
        checks.push({ status: ratio > 0.9 ? 'critical' : ratio > 0.75 ? 'warning' : 'ok', message: `${pct(ratio)} of buffer pool pages are dirty (awaiting flush).` });
    }
    const size = num(variables, 'innodb_buffer_pool_size');
    if (size !== null) checks.push({ status: 'ok', message: `innodb_buffer_pool_size is ${(size / 1024 ** 3).toFixed(2)} GiB.` });
    return checks;
}

export function evaluateConnections(status, variables) {
    const checks = [];
    const max = num(variables, 'max_connections'), connected = num(status, 'Threads_connected'), peak = num(status, 'Max_used_connections');
    if (max && connected !== null) {
        const ratio = connected / max;
        checks.push({ status: ratio > 0.9 ? 'critical' : ratio > 0.75 ? 'warning' : 'ok', message: `${connected} of ${max} connections in use (${pct(ratio)}).` });
    }
    if (max && peak !== null) {
        const ratio = peak / max;
        checks.push({ status: ratio >= 1 ? 'critical' : ratio > 0.85 ? 'warning' : 'ok', message: `Peak usage since start: ${peak} of ${max} connections (${pct(ratio)}).` });
    }
    const refused = num(status, 'Connection_errors_max_connections');
    if (refused !== null) checks.push({ status: refused > 0 ? 'critical' : 'ok', message: `${refused} connection(s) refused because max_connections was reached.` });
    const running = num(status, 'Threads_running');
    if (running !== null) checks.push({ status: running > 50 ? 'warning' : 'ok', message: `${running} thread(s) actively running.` });
    return checks;
}

export async function collectServerHealth(connection, warnings) {
    let status, variables;
    try {
        status = toMap((await connection.query('SHOW GLOBAL STATUS'))[0]);
        variables = toMap((await connection.query("SHOW GLOBAL VARIABLES WHERE Variable_name IN ('max_connections', 'innodb_buffer_pool_size')"))[0]);
    } catch (error) {
        warnings.push(`Server health checks unavailable (${error.code || 'QUERY_ERROR'}): ${error.message}`);
        return null;
    }
    const area = checks => ({ status: worst(checks), checks });
    return {
        uptimeSeconds: num(status, 'Uptime'),
        lockContention: area(evaluateLockContention(status)),
        diskIo: area(evaluateDiskIo(status)),
        memory: area(evaluateMemory(status, variables)),
        connections: area(evaluateConnections(status, variables)),
        // Keep raw status so lock waits found later can be folded in.
        _status: status,
    };
}

export function finalizeLockContention(health, lockWaitRows) {
    if (!health) return;
    const checks = evaluateLockContention(health._status, lockWaitRows);
    health.lockContention = { status: worst(checks), checks };
    delete health._status;
}

// One summary line per area, so users see everything at a glance.
export function buildNotifications(report) {
    const notes = [];
    const add = (area, status, message) => notes.push({ area, status, message });
    const dups = report.duplicateIndexes || [];
    add('Duplicate indexes', dups.length ? 'warning' : 'ok', dups.length
        ? `${dups.length} duplicate or redundant index(es) found; they slow writes and waste memory.`
        : 'No duplicate or redundant indexes found.');
    const needed = (report.indexCandidates || []).filter(row => row.indexAssessment?.status === 'index_may_help');
    if (report.available) {
        add('Needed indexes', needed.length ? 'warning' : (report.indexCandidates?.length ? 'info' : 'ok'), needed.length
            ? `${needed.length} query pattern(s) would likely benefit from a new index.`
            : report.indexCandidates?.length ? `${report.indexCandidates.length} query pattern(s) scan many rows; review their execution plans.` : 'No queries flagged as needing an index.');
        const slow = report.slowQueries || [];
        add('Slow queries', slow.length ? 'warning' : 'ok', slow.length
            ? `${slow.length} query pattern(s) exceeded ${report.thresholds.slowMs / 1000} s.`
            : `No query patterns exceeded ${report.thresholds.slowMs / 1000} s.`);
    } else {
        add('Needed indexes', 'unknown', 'Unavailable: Performance Schema statistics could not be read.');
        add('Slow queries', 'unknown', 'Unavailable: Performance Schema statistics could not be read.');
    }
    const health = report.serverHealth;
    for (const [key, label] of [['lockContention', 'Lock contention'], ['diskIo', 'Disk I/O saturation'], ['memory', 'Memory & buffer pool'], ['connections', 'Connection exhaustion']]) {
        const area = health?.[key];
        if (!area) { add(label, 'unknown', 'Unavailable: server status could not be read.'); continue; }
        const problems = area.checks.filter(c => c.status !== 'ok');
        add(label, area.status, problems.length ? problems.map(c => c.message).join(' ') : 'No problems detected.');
    }
    return notes;
}
