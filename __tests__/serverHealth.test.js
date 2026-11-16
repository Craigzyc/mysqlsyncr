import { evaluateConnections, evaluateDiskIo, evaluateLockContention, evaluateMemory, collectServerHealth, buildNotifications, finalizeLockContention } from '../src/serverHealth';

const m = obj => Object.fromEntries(Object.entries(obj).map(([k, v]) => [k.toLowerCase(), String(v)]));
const statuses = checks => checks.map(c => c.status);

test('connection exhaustion thresholds', () => {
    const vars = m({ max_connections: 100 });
    expect(statuses(evaluateConnections(m({ Threads_connected: 95, Max_used_connections: 100, Connection_errors_max_connections: 3, Threads_running: 2 }), vars)))
        .toEqual(['critical', 'critical', 'critical', 'ok']);
    expect(statuses(evaluateConnections(m({ Threads_connected: 10, Max_used_connections: 20, Connection_errors_max_connections: 0 }), vars)))
        .toEqual(['ok', 'ok', 'ok']);
});

test('buffer pool hit ratio and waits', () => {
    const checks = evaluateMemory(m({ Innodb_buffer_pool_read_requests: 1000, Innodb_buffer_pool_reads: 100, Innodb_buffer_pool_wait_free: 0 }), m({}));
    expect(checks[0]).toMatchObject({ status: 'critical' });
    expect(checks[0].message).toContain('90.0%');
    expect(checks[1].status).toBe('ok');
});

test('disk I/O pending ops and tmp spills', () => {
    expect(statuses(evaluateDiskIo(m({ Innodb_data_pending_reads: 2, Innodb_log_waits: 0, Created_tmp_tables: 100, Created_tmp_disk_tables: 50 }))))
        .toEqual(['warning', 'ok', 'critical']);
});

test('lock contention includes live blocking transactions', () => {
    const checks = evaluateLockContention(m({ Innodb_row_lock_current_waits: 0, Innodb_row_lock_time_avg: 5 }), [{}]);
    expect(statuses(checks)).toEqual(['ok', 'ok', 'critical']);
});

test('collects via SHOW statements and summarizes every area', async () => {
    const connection = { query: jest.fn(async sql => sql.startsWith('SHOW GLOBAL STATUS')
        ? [[{ Variable_name: 'Threads_connected', Value: '99' }, { Variable_name: 'Innodb_row_lock_current_waits', Value: '0' }]]
        : [[{ Variable_name: 'max_connections', Value: '100' }]]) };
    const health = await collectServerHealth(connection, []);
    finalizeLockContention(health, []);
    expect(health._status).toBeUndefined();
    const notes = buildNotifications({ available: true, thresholds: { slowMs: 2000 }, duplicateIndexes: [{}], slowQueries: [], indexCandidates: [], serverHealth: health });
    expect(notes.map(n => n.area)).toEqual(['Duplicate indexes', 'Needed indexes', 'Slow queries', 'Lock contention', 'Disk I/O saturation', 'Memory & buffer pool', 'Connection exhaustion']);
    expect(notes.find(n => n.area === 'Connection exhaustion').status).toBe('critical');
    expect(notes.find(n => n.area === 'Duplicate indexes').status).toBe('warning');
});

test('reports unavailable areas when status cannot be read', async () => {
    const warnings = [];
    const health = await collectServerHealth({ query: jest.fn().mockRejectedValue(Object.assign(new Error('denied'), { code: 'ER_SPECIFIC_ACCESS_DENIED_ERROR' })) }, warnings);
    expect(health).toBeNull();
    expect(warnings[0]).toMatch(/unavailable/);
    const notes = buildNotifications({ available: false, serverHealth: null });
    expect(notes.filter(n => n.status === 'unknown')).toHaveLength(6);
});
