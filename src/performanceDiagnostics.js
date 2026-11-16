import { randomUUID } from 'node:crypto';

const snapshots = new Map();
const ttl = 15 * 60 * 1000;
const counters = ['execution_count', 'rows_examined', 'rows_sent', 'no_index_used', 'no_good_index_used',
    'tmp_tables', 'disk_tmp_tables', 'sort_rows', 'sort_merge_passes', 'sort_scans', 'sort_ranges'];

export function compareSnapshots(previous, current, minExecutions = 1, limit = 10, slowMs = 0) {
    const before = new Map(previous.map(row => [JSON.stringify([row.database_name, row.digest]), row]));
    const rows = [];
    let skipped = 0;
    for (const row of current) {
        const old = before.get(JSON.stringify([row.database_name, row.digest]));
        if (!old || String(old.first_seen) !== String(row.first_seen)) { skipped++; continue; }
        const delta = { ...row, interval: true, max_ms: null, indexAssessment: undefined };
        let valid = true;
        for (const field of [...counters, 'total_ms']) {
            const now = Number(row[field]), then = Number(old[field]);
            if (!Number.isFinite(now) || !Number.isFinite(then) || now < then ||
                (field !== 'total_ms' && (!Number.isSafeInteger(now) || !Number.isSafeInteger(then)))) { valid = false; break; }
            delta[field] = now - then;
        }
        if (!valid) { skipped++; continue; }
        if (!delta.execution_count || delta.execution_count < minExecutions) continue;
        delta.avg_ms = delta.total_ms / delta.execution_count;
        if (delta.avg_ms <= slowMs) continue;
        delta.scan_ratio = delta.rows_examined / Math.max(delta.rows_sent, 1);
        rows.push(delta);
    }
    return { rows: rows.sort((a, b) => b.total_ms - a.total_ms).slice(0, limit), skipped };
}

// information_schema.INNODB_LOCK_WAITS exists in MySQL 5.5-5.7 and was removed in 8.0.
// 5.7's sys.innodb_lock_waits lacks locked_table_schema, so only 8.0 uses the sys view.
async function hasLegacyLockTables(connection) {
    try {
        const [rows] = await connection.query(`SELECT 1 FROM information_schema.TABLES
            WHERE TABLE_SCHEMA = 'information_schema' AND TABLE_NAME = 'INNODB_LOCK_WAITS' LIMIT 1`);
        return rows.length > 0;
    } catch {
        return false;
    }
}

export async function collectDiagnostics(connection, report, select, params, options) {
    const optional = async (key, label, sql, values) => {
        try {
            const [rows] = await connection.query(sql, values);
            report.diagnostics[key] = { available: true, rows };
        } catch (error) {
            report.diagnostics[key] = { available: false, rows: [] };
            report.warnings.push(`${label} unavailable (${error.code || 'QUERY_ERROR'}). Check SELECT permissions and MySQL/sys schema compatibility.`);
        }
    };
    report.diagnostics = {};
    const lockScope = column => report.database ? `${column} = ?` : `${column} NOT IN ('mysql', 'sys', 'performance_schema', 'information_schema')`;
    if (await hasLegacyLockTables(connection)) {
        // MySQL 5.5-5.7: read the InnoDB lock tables directly.
        // LOCK_TABLE is like `schema`.`table`.
        await optional('lockWaits', 'Blocking transaction inspection', `SELECT * FROM (SELECT
            SUBSTRING_INDEX(REPLACE(bl.lock_table, '\`', ''), '.', 1) AS database_name,
            SUBSTRING_INDEX(REPLACE(bl.lock_table, '\`', ''), '.', -1) AS table_name,
            rl.lock_index AS locked_index, r.trx_mysql_thread_id AS waiting_pid, b.trx_mysql_thread_id AS blocking_pid,
            TIMESTAMPDIFF(SECOND, r.trx_wait_started, NOW()) AS wait_seconds,
            r.trx_rows_locked AS waiting_trx_rows_locked, b.trx_rows_locked AS blocking_trx_rows_locked
            FROM information_schema.INNODB_LOCK_WAITS w
            JOIN information_schema.INNODB_TRX r ON r.trx_id = w.requesting_trx_id
            JOIN information_schema.INNODB_TRX b ON b.trx_id = w.blocking_trx_id
            JOIN information_schema.INNODB_LOCKS rl ON rl.lock_id = w.requested_lock_id
            JOIN information_schema.INNODB_LOCKS bl ON bl.lock_id = w.blocking_lock_id) waits
            WHERE ${lockScope('database_name')} AND wait_seconds > ?
            ORDER BY wait_seconds DESC LIMIT ?`, [...params, report.thresholds.slowMs / 1000, report.thresholds.limit]);
    } else await optional('lockWaits', 'Blocking transaction inspection', `SELECT locked_table_schema AS database_name,
        locked_table_name AS table_name, locked_index, waiting_pid, blocking_pid, wait_age_secs AS wait_seconds,
        waiting_trx_rows_locked, blocking_trx_rows_locked
        FROM sys.innodb_lock_waits
        WHERE ${report.database ? 'locked_table_schema = ?' : "locked_table_schema NOT IN ('mysql', 'sys', 'performance_schema', 'information_schema')"}
        AND wait_age_secs > ?
        ORDER BY wait_age_secs DESC LIMIT ?`, [...params, report.thresholds.slowMs / 1000, report.thresholds.limit]);
    let currentEnabled = false;
    try {
        const [consumers] = await connection.query("SELECT ENABLED FROM performance_schema.setup_consumers WHERE NAME = 'events_statements_current'");
        currentEnabled = consumers[0]?.ENABLED === 'YES';
        if (!currentEnabled) report.warnings.push('Live query inspection unavailable: events_statements_current consumer is disabled.');
    } catch (error) {
        report.warnings.push(`Live query instrumentation status unavailable (${error.code || 'QUERY_ERROR'}).`);
    }
    if (currentEnabled) await optional('liveQueries', 'Live query inspection', `SELECT t.PROCESSLIST_DB AS database_name,
        t.PROCESSLIST_ID AS connection_id, t.PROCESSLIST_STATE AS state,
        s.DIGEST_TEXT AS query_text, s.TIMER_WAIT / 1000000000000 AS elapsed_seconds
        FROM performance_schema.threads t
        JOIN performance_schema.events_statements_current s ON s.THREAD_ID = t.THREAD_ID
        WHERE t.TYPE = 'FOREGROUND' AND t.PROCESSLIST_ID <> CONNECTION_ID()
        AND t.PROCESSLIST_COMMAND <> 'Sleep' AND s.END_EVENT_ID IS NULL
        AND s.TIMER_WAIT > ?
        AND ${report.database ? 't.PROCESSLIST_DB = ?' : "t.PROCESSLIST_DB IS NOT NULL AND t.PROCESSLIST_DB NOT IN ('mysql', 'sys', 'performance_schema', 'information_schema')"}
        ORDER BY s.TIMER_WAIT DESC LIMIT ?`, [report.thresholds.slowMs * 1000000000, ...params, report.thresholds.limit]);
    else report.diagnostics.liveQueries = { available: false, rows: [] };
    report.warnings.push('All query categories use the configured duration threshold: lifetime maximum for cumulative digests, interval average for recent activity, elapsed time for live queries, and wait age for blocking transactions. Empty live/lock snapshots do not rule out intermittent blocking. Live queries require events_statements_current instrumentation. No sessions are killed.');

    report.interval = { available: false, rows: [], message: 'Baseline captured. Run Check performance again to compare activity between checks.' };
    try {
        // SHOW STATUS works on every version; performance_schema.global_status is 5.7+.
        const [[uptime]] = await connection.query("SHOW GLOBAL STATUS LIKE 'Uptime'");
        const [[clock]] = await connection.query('SELECT UNIX_TIMESTAMP() AS now');
        let serverUuid;
        try {
            [[{ server_uuid: serverUuid }]] = await connection.query('SELECT @@server_uuid AS server_uuid');
        } catch {
            // MySQL 5.5 has no server_uuid; hostname + port identifies the server well enough.
            [[{ server_uuid: serverUuid }]] = await connection.query("SELECT CONCAT(@@hostname, ':', @@port) AS server_uuid");
        }
        const server = { server_uuid: serverUuid, server_started: Number(clock.now) - Number(uptime?.Value) };
        if (!server?.server_uuid || !Number.isFinite(Number(server.server_started))) throw new Error('Identity unavailable');
        // Independent of category limits/thresholds so changing thresholds does
        // not subtract unrelated top-N lists. Bounded to protect backend memory.
        const [all] = await connection.query(`${select} ORDER BY SCHEMA_NAME, DIGEST LIMIT 5001`, [...params, 1]);
        const now = Date.now();
        for (const [id, value] of snapshots) if (now - value.time > ttl) snapshots.delete(id);
        const previous = snapshots.get(options.baselineId);
        const scope = JSON.stringify([server.server_uuid, report.database, options.snapshotOwner || '']);
        if (previous && previous.scope === scope && Math.abs(Number(server.server_started) - previous.serverStarted) <= 3 && all.length <= 5000 && !previous.truncated) {
            const result = compareSnapshots(previous.rows, all, report.thresholds.minExecutions, report.thresholds.limit, report.thresholds.slowMs);
            report.interval = { available: true, rows: result.rows, from: previous.checkedAt, to: report.checkedAt,
                seconds: (now - previous.time) / 1000,
                message: `Activity since previous check; average execution time must exceed ${report.thresholds.slowMs / 1000} s with minimum ${report.thresholds.minExecutions} interval executions. ${result.skipped} new, reset, or uncomparable digests omitted. Interval maximum time cannot be derived from cumulative statistics.` };
        } else if (options.baselineId) {
            report.interval.message = 'A new baseline was captured: the previous baseline expired, the server/scope changed, or snapshot coverage exceeded 5,000 digests. Run the check again.';
        }
        const id = randomUUID();
        while (snapshots.size >= 20) snapshots.delete(snapshots.keys().next().value);
        snapshots.set(id, { time: now, checkedAt: report.checkedAt, rows: all.slice(0, 5000), truncated: all.length > 5000,
            scope, serverStarted: Number(server.server_started) });
        report.snapshotId = id;
        if (all.length > 5000) report.interval.message = 'Interval comparison unavailable: scope exceeds 5,000 digests. Select a smaller schema.';
    } catch (error) {
        report.interval.message = `Interval comparison unavailable (${error.code || 'QUERY_ERROR'}). Check Performance Schema identity, uptime and digest access.`;
    }
}
