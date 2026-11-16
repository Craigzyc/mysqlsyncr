import mysql from 'mysql2';
import { checkPerformance, collectPerformanceReport, performanceOptions } from '../src/performance';

jest.mock('mysql2', () => ({ createConnection: jest.fn() }));

function connection({ enabled = 1, consumer = 'YES', count = 2, parentConsumer = 'YES', instrumentCount = 10 } = {}) {
    return {
        query: jest.fn(async (sql) => {
            if (sql.includes('information_schema.STATISTICS') || sql.startsWith('SHOW GLOBAL')) return [[]];
            if (sql.includes('@@performance_schema')) return [[{ enabled }]];
            if (sql.includes('setup_consumers') && sql.includes('statements_digest')) return [[
                { NAME: 'statements_digest', ENABLED: consumer },
                { NAME: 'global_instrumentation', ENABLED: parentConsumer },
                { NAME: 'thread_instrumentation', ENABLED: parentConsumer },
            ]];
            if (sql.includes('setup_consumers')) return [[{ ENABLED: consumer }]];
            if (sql.includes('setup_instruments')) return [[{ total: 10, enabled: instrumentCount, timed: instrumentCount }]];
            if (sql.includes('digest_count')) return [[{ digest_count: count }]];
            return [[{ digest: 'abc', database_name: 'app', query_text: 'SELECT * FROM `t` WHERE `id` = ?' }]];
        }),
        end: jest.fn().mockResolvedValue(),
    };
}

test('separates slow executions from index candidates with bound schema and thresholds', async () => {
    const db = connection();
    const report = await collectPerformanceReport(db, { database: "app' OR 1=1", slowMs: 1000, minExecutions: 2, limit: 5 });
    const slow = db.query.mock.calls.find(([sql]) => sql.includes('AND MAX_TIMER_WAIT'));
    expect(slow[0]).not.toContain("app' OR 1=1");
    expect(slow[1]).toEqual(["app' OR 1=1", 2, 1000000000000, 5]);
    const indexes = db.query.mock.calls.find(([sql]) => sql.includes('AND SUM_ROWS_EXAMINED >= ?'));
    expect(indexes[0]).toContain('GREATEST(SUM_ROWS_SENT, 1)');
    expect(indexes[0]).toContain('SUM_NO_GOOD_INDEX_USED > 0');
    expect(indexes[1]).toEqual(["app' OR 1=1", 2, 1000000000000, 1000, 1000, 5]);
    expect(slow[0]).toContain('MAX_TIMER_WAIT > ?');
    expect(indexes[0]).toContain('MAX_TIMER_WAIT > ?');
    expect(report.available).toBe(true);
    expect(report.slowQueries).toHaveLength(1);
    expect(report.indexCandidates).toHaveLength(1);
    expect(report.highestTotalTime).toHaveLength(1);
    expect(report.tempAndSortQueries).toHaveLength(1);
    expect(slow[0]).toContain('SUM_CREATED_TMP_DISK_TABLES');
    expect(slow[0]).toContain('SUM_SORT_MERGE_PASSES');
    expect(db.query.mock.calls.every(([sql]) => /^(SELECT|SHOW)\s/.test(sql.trim()))).toBe(true);
    expect(slow[0]).toContain('DIGEST_TEXT NOT REGEXP');
    expect(slow[0]).toContain('INFORMATION_SCHEMA|PERFORMANCE_SCHEMA|MYSQL|SYS');
    expect(report.slowQueries[0].indexAssessment.status).toBe('inconclusive');
});

test('all-schema reports exclude system schemas', async () => {
    const db = connection();
    await collectPerformanceReport(db);
    expect(db.query.mock.calls.find(([sql]) => sql.includes('AND MAX_TIMER_WAIT'))[0])
        .toContain("SCHEMA_NAME NOT IN ('mysql', 'sys', 'performance_schema', 'information_schema')");
});

test.each([2000, 3500])('applies duration threshold to every cumulative category before limiting: %s ms', async slowMs => {
    const db = connection();
    await collectPerformanceReport(db, { slowMs, minExecutions: 2, limit: 5 });
    const categories = db.query.mock.calls.filter(([sql]) => /ORDER BY (SUM_TIMER_WAIT|SUM_ROWS_EXAMINED) DESC LIMIT/.test(sql));
    expect(categories).toHaveLength(4);
    for (const [sql, values] of categories) {
        expect(sql).toContain('AND MAX_TIMER_WAIT > ?');
        expect(values[1]).toBe(slowMs * 1000000000);
    }
});

test('defaults to a two-second cutoff', () => {
    expect(performanceOptions().slowMs).toBe(2000);
});

test('disabled Performance Schema is unavailable rather than a clean result', async () => {
    const db = connection({ enabled: 0 });
    const report = await collectPerformanceReport(db);
    expect(report.available).toBe(false);
    expect(report.warnings.join(' ')).toMatch(/disabled/);
    // Index metadata, global status/variables, and Performance Schema status only.
    expect(db.query).toHaveBeenCalledTimes(4);
    expect(report.notifications).toHaveLength(7);
});

test('warns about disabled digest collection and empty coverage', async () => {
    const report = await collectPerformanceReport(connection({ consumer: 'NO', count: 0 }));
    expect(report.warnings.join(' ')).toMatch(/missing or stale/);
    expect(report.warnings.join(' ')).toMatch(/does not establish/);
    expect(report.digestCoverage).toEqual({ count: 0, complete: false });
});

test('reports failed duplicate-index metadata as unavailable', async () => {
    const db = connection();
    const original = db.query.getMockImplementation();
    db.query.mockImplementation(async sql => {
        if (sql.includes('information_schema.STATISTICS')) throw new Error('Metadata denied');
        return original(sql);
    });
    const report = await collectPerformanceReport(db);
    expect(report.duplicateIndexesAvailable).toBe(false);
    expect(report.notifications.find(note => note.area === 'Duplicate indexes').status).toBe('unknown');
});

test.each([{ parentConsumer: 'NO' }, { instrumentCount: 9 }])('detects disabled parent consumers or statement classes: %p', async settings => {
    const report = await collectPerformanceReport(connection(settings));
    expect(report.digestCoverage.complete).toBe(false);
    expect(report.warnings.join(' ')).toMatch(/instrumentation|instruments/);
});

test.each([{ limit: '5' }, { limit: 101 }, { minExecutions: 0 }, { slowMs: -1 }, { slowMs: 999 }, { scanRatio: NaN }, { minRowsExamined: 1.2 }])('rejects invalid thresholds: %p', (options) => {
    expect(() => performanceOptions(options)).toThrow();
});

test('closes its connection after query failures and adds permission guidance', async () => {
    const db = connection();
    db.query.mockRejectedValue(Object.assign(new Error('Access denied'), { code: 'ER_TABLEACCESS_DENIED_ERROR' }));
    mysql.createConnection.mockReturnValue({ promise: () => db });
    await expect(checkPerformance({ host: 'localhost' })).rejects.toThrow(/SELECT access/);
    expect(db.end).toHaveBeenCalledTimes(1);
});

test('closes after success and uses config database unless explicitly overridden', async () => {
    const db = connection();
    mysql.createConnection.mockReturnValue({ promise: () => db });
    expect((await checkPerformance({ database: 'app' })).database).toBe('app');
    expect((await checkPerformance({ database: 'app' }, { database: '' })).database).toBeNull();
    expect(db.end).toHaveBeenCalledTimes(2);
});

test('MySQL 5.5 skips digest statistics but still reports index and server health', async () => {
    const db = connection();
    db.query.mockImplementation(async sql => {
        if (sql.includes('@@performance_schema')) return [[{ enabled: 1, version: '5.5.62-log' }]];
        return [[]];
    });
    const report = await collectPerformanceReport(db, {});
    expect(report.available).toBe(false);
    expect(report.warnings.join(' ')).toMatch(/requires 5\.6/);
    expect(db.query.mock.calls.some(([sql]) => sql.includes('events_statements_summary_by_digest'))).toBe(false);
    expect(report.notifications).toHaveLength(7);
});
