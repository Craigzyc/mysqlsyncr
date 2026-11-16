import { compareSnapshots, collectDiagnostics } from '../src/performanceDiagnostics';

const row = (overrides = {}) => ({ database_name: 'app', digest: 'abc', query_text: 'SELECT * FROM t', first_seen: '2026-11-13',
    execution_count: 10, total_ms: 100, rows_examined: 1000, rows_sent: 10, no_index_used: 1, no_good_index_used: 0,
    tmp_tables: 1, disk_tmp_tables: 0, sort_rows: 100, sort_merge_passes: 0, sort_scans: 1, sort_ranges: 0, ...overrides });

test('subtracts counters and derives interval average without inventing interval maximum', () => {
    const result = compareSnapshots([row()], [row({ execution_count: 12, total_ms: 150, rows_examined: 1300, rows_sent: 20, tmp_tables: 3, sort_rows: 150 })], 2);
    expect(result.rows[0]).toMatchObject({ execution_count: 2, total_ms: 50, avg_ms: 25, max_ms: null,
        rows_examined: 300, rows_sent: 10, scan_ratio: 30, tmp_tables: 2, sort_rows: 50, interval: true });
});

test('omits new digests, resets, unsafe counters, idle digests and below-threshold activity', () => {
    const previous = Array.from({ length: 5 }, (_, n) => row({ digest: String(n) }));
    const current = [row({ digest: 'new' }), row({ digest: '0', execution_count: 1 }), row({ digest: '1', first_seen: 'changed' }),
        row({ digest: '2', execution_count: Number.MAX_SAFE_INTEGER + 1 }), row({ digest: '3' }), row({ digest: '4', execution_count: 11 })];
    const result = compareSnapshots(previous, current, 2);
    expect(result.rows).toEqual([]);
    expect(result.skipped).toBe(4);
});

test('ranks by interval work rather than lifetime totals and respects the limit', () => {
    const previous = [row({ digest: 'a', total_ms: 10000 }), row({ digest: 'b' })];
    const current = [row({ digest: 'a', total_ms: 10001, execution_count: 11 }), row({ digest: 'b', total_ms: 200, execution_count: 11 })];
    expect(compareSnapshots(previous, current, 1, 1).rows.map(item => item.digest)).toEqual(['b']);
});

function db({ failLocks = false, server = 'test-server', started = 100, current = row(), consumer = 'YES', sysSchema = true } = {}) {
    return { query: jest.fn(async sql => {
        if (sql.includes('setup_consumers')) return [[{ ENABLED: consumer }]];
        if (sql.includes('sys.innodb_lock_waits')) {
            if (failLocks) throw Object.assign(new Error('private query in error'), { code: 'ER_TABLEACCESS_DENIED_ERROR' });
            return [[{ database_name: 'app', waiting_pid: 1, blocking_pid: 2, wait_seconds: 3 }]];
        }
        if (sql.includes('events_statements_current')) return [[]];
        if (sql.includes('@@server_uuid')) {
            if (!server) throw Object.assign(new Error('unknown variable'), { code: 'ER_UNKNOWN_SYSTEM_VARIABLE' });
            return [[{ server_uuid: server }]];
        }
        if (sql.includes('@@hostname')) return [[{ server_uuid: 'host:3306' }]];
        if (sql.includes("LIKE 'Uptime'")) return [[{ Variable_name: 'Uptime', Value: String(1000 - started) }]];
        if (sql.includes('UNIX_TIMESTAMP()')) return [[{ now: 1000 }]];
        if (sql.includes("TABLE_NAME = 'INNODB_LOCK_WAITS'")) return [sysSchema ? [] : [{ 1: 1 }]];
        if (sql.includes('INNODB_LOCK_WAITS')) return [[{ database_name: 'app', waiting_pid: 5, blocking_pid: 6, wait_seconds: 9 }]];
        return [[current]];
    }) };
}
const report = () => ({ database: 'app', checkedAt: new Date().toISOString(), warnings: [], thresholds: { minExecutions: 1, limit: 5, slowMs: 0 } });
const collect = async (connection, options = {}) => {
    const result = report();
    await collectDiagnostics(connection, result, 'SELECT digest FROM digests WHERE schema_name = ? AND executions >= ?', ['app'], options);
    return result;
};

test('captures a bounded backend baseline then compares the next check', async () => {
    const first = await collect(db());
    expect(first.interval.available).toBe(false);
    const second = await collect(db({ current: row({ execution_count: 11, total_ms: 120 }) }), { baselineId: first.snapshotId });
    expect(second.interval.available).toBe(true);
    expect(second.interval.rows[0].total_ms).toBe(20);
    expect(second.snapshotId).not.toBe(first.snapshotId);
});

test('disabled current-statement collection is unavailable rather than an empty healthy result', async () => {
    const result = await collect(db({ consumer: 'NO' }));
    expect(result.diagnostics.liveQueries).toEqual({ available: false, rows: [] });
    expect(result.warnings.join(' ')).toContain('consumer is disabled');
});

test.each([{ server: 'other' }, { started: 200 }])('does not compare across a different server or restart: %p', async overrides => {
    const first = await collect(db());
    const second = await collect(db(overrides), { baselineId: first.snapshotId });
    expect(second.interval.available).toBe(false);
    expect(second.interval.message).toContain('new baseline');
});

test('isolates snapshots by connection owner and expires old baselines', async () => {
    const first = await collect(db(), { snapshotOwner: 'alice' });
    expect((await collect(db(), { snapshotOwner: 'bob', baselineId: first.snapshotId })).interval.available).toBe(false);
    const clock = jest.spyOn(Date, 'now').mockReturnValue(Date.now() + 16 * 60 * 1000);
    try { expect((await collect(db(), { snapshotOwner: 'alice', baselineId: first.snapshotId })).interval.available).toBe(false); }
    finally { clock.mockRestore(); }
});

test('handles unavailable diagnostics independently and sanitizes errors', async () => {
    const connection = db({ failLocks: true });
    const result = await collect(connection);
    expect(result.diagnostics.lockWaits.available).toBe(false);
    expect(result.diagnostics.liveQueries.available).toBe(true);
    expect(result.warnings.join(' ')).toContain('ER_TABLEACCESS_DENIED_ERROR');
    expect(JSON.stringify(result)).not.toContain('private query');
    const calls = connection.query.mock.calls;
    expect(calls.every(([sql]) => /^(SELECT|SHOW)\s/.test(sql))).toBe(true);
    expect(calls.find(([sql]) => sql.includes('sys.innodb_lock_waits'))[1]).toEqual(['app', 0, 5]);
    expect(calls.some(([sql]) => /SQL_TEXT|waiting_query|blocking_query|sql_kill/.test(sql))).toBe(false);
});

test('interval duration filtering uses interval average, not lifetime maximum or total', () => {
    const before = [row({ total_ms: 100, max_ms: 90000 })];
    const fast = [row({ total_ms: 3100, execution_count: 12, max_ms: 90000 })];
    const exact = [row({ total_ms: 4100, execution_count: 12, max_ms: 90000 })];
    const slow = [row({ total_ms: 5100, execution_count: 12, max_ms: 90000 })];
    expect(compareSnapshots(before, fast, 1, 10, 2000).rows).toEqual([]);
    expect(compareSnapshots(before, exact, 1, 10, 2000).rows).toEqual([]);
    expect(compareSnapshots(before, slow, 1, 10, 2000).rows[0].avg_ms).toBe(2500);
    expect(compareSnapshots(before, slow, 1, 10, 3000).rows).toEqual([]);
});

test('live and lock SQL binds the configured threshold in seconds and picoseconds', async () => {
    const connection = db();
    const result = report();
    result.thresholds.slowMs = 3500;
    await collectDiagnostics(connection, result, 'SELECT digest FROM digests WHERE schema_name = ? AND executions >= ?', ['app'], {});
    expect(connection.query.mock.calls.find(([sql]) => sql.includes('sys.innodb_lock_waits'))[1]).toEqual(['app', 3.5, 5]);
    expect(connection.query.mock.calls.find(([sql]) => sql.includes('JOIN performance_schema.events_statements_current'))[1]).toEqual([3500000000000, 'app', 5]);
});

test('MySQL 5.x with legacy InnoDB lock tables or server_uuid still inspects locks and baselines', async () => {
    const connection = db({ sysSchema: false, server: null });
    const result = await collect(connection);
    expect(result.diagnostics.lockWaits).toEqual({ available: true, rows: [expect.objectContaining({ blocking_pid: 6 })] });
    expect(connection.query.mock.calls.some(([sql]) => sql.includes('sys.innodb_lock_waits'))).toBe(false);
    expect(result.snapshotId).toBeTruthy();
});
