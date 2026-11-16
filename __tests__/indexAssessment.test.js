import { inspectSample, assessQueryIndexes, assessPerformanceRows } from '../src/indexAssessment';

const row = { database_name: 'app', digest: 'abc' };
const sample = "SELECT t.id FROM readings AS t WHERE t.sensor_id = 42";
function db(plan = [{ table: 't', type: 'ALL', key: null, possible_keys: null, rows: 50000, Extra: 'Using where' }]) {
    return { query: jest.fn(async (sql) => {
        if (sql.includes('information_schema.TABLES')) return [[{ TABLE_TYPE: 'BASE TABLE' }]];
        if (sql.includes('information_schema.COLUMNS')) return [['config_hash', 'tableName', 'end', 'id', 'active', 'sensor_id'].map(COLUMN_NAME => ({ COLUMN_NAME }))];
        if (sql.includes('information_schema.STATISTICS')) return [[{ INDEX_NAME: 'PRIMARY', NON_UNIQUE: 0, COLUMN_NAME: 'id', SUB_PART: null }]];
        if (sql.startsWith('EXPLAIN')) return [plan];
        if (sql.startsWith('USE ')) return [[]];
        if (sql.includes('QUERY_SAMPLE_TEXT')) return [[{ sample_sql: sample }]];
        return [[]];
    }) };
}

test('associates table aliases and schema-qualified tables', () => {
    const parsed = inspectSample('SELECT a.id FROM app.readings a JOIN other.sensors AS b ON a.sensor_id = b.id WHERE b.active = 1', 'app');
    expect(parsed.tables).toEqual([{ schema: 'app', name: 'readings', alias: 'a' }, { schema: 'other', name: 'sensors', alias: 'b' }]);
});

test.each([
    'DELETE FROM readings WHERE id = 1',
    'SELECT SLEEP(10) FROM readings',
    'SELECT app.my_function(id) FROM readings',
    'SELECT `my_function`(id) FROM readings',
    'SELECT * FROM readings WHERE id IN (SELECT id FROM sensors WHERE SLEEP(1) = 0)',
    'SELECT (SELECT id FROM sensors) FROM readings',
    'SELECT * FROM (SELECT id FROM sensors) AS readings',
    'SELECT * FROM readings r WHERE id IN (SELECT id FROM sensors r)',
    'SELECT * FROM readings; DROP TABLE readings',
    "SELECT * FROM readings INTO OUTFILE '/tmp/test'",
    'SELECT * FROM readings FOR UPDATE',
    'SELECT * FROM readings WHERE id = ?',
    'SELECT /*+ dangerous */ * FROM readings',
    'WITH r AS (SELECT * FROM readings) SELECT * FROM r',
    'SELECT * FROM readings, sensors WHERE readings.id = sensors.id',
    'SELECT * FROM information_schema.tables',
    'SELECT @secret FROM readings',
])('does not automatically explain unsupported or potentially active SQL: %s', (sql) => {
    expect(inspectSample(sql, 'app')).toBeNull();
});

test('flags substantial filtered scans and returns existing index evidence', async () => {
    const connection = db();
    const result = await assessQueryIndexes(connection, row, sample);
    expect(result.status).toBe('index_may_help');
    expect(result.tables[0]).toMatchObject({ name: 'readings', alias: 't', estimatedRows: 50000, chosenIndex: null });
    expect(result.tables[0].existingIndexes[0]).toEqual({ name: 'PRIMARY', unique: true, columns: [{ name: 'id', prefixLength: null }] });
    expect(connection.query.mock.calls.find(([sql]) => sql.startsWith('EXPLAIN'))[0]).toBe(`EXPLAIN FORMAT=TRADITIONAL ${sample}`);
    expect(connection.query.mock.calls.some(([sql]) => /EXPLAIN ANALYZE|CREATE INDEX/.test(sql))).toBe(false);
    expect(JSON.stringify(result)).not.toContain('sensor_id = 42');
});

test('distinguishes existing unused indexes from a missing lookup index', async () => {
    const result = await assessQueryIndexes(db([{ table: 't', type: 'ALL', key: null, possible_keys: 'idx_sensor', rows: 50000 }]), row, sample);
    expect(result.status).toBe('review_existing_indexes');
});

test('does not recommend an index just because an indexed query was slow', async () => {
    const result = await assessQueryIndexes(db([{ table: 't', type: 'ref', key: 'idx_sensor', possible_keys: 'idx_sensor', rows: 10 }]), row, sample);
    expect(result.status).toBe('index_used');
});

test('does not call an intentional unfiltered full scan a missing index', async () => {
    const result = await assessQueryIndexes(db([{ table: 'readings', type: 'ALL', key: null, possible_keys: null, rows: 50000 }]), row, 'SELECT * FROM readings');
    expect(result.status).toBe('scan_without_filter');
});

test('rejects views before EXPLAIN', async () => {
    const connection = db();
    connection.query.mockResolvedValueOnce([[{ TABLE_TYPE: 'VIEW' }]]);
    expect((await assessQueryIndexes(connection, row, sample)).status).toBe('inconclusive');
    expect(connection.query).toHaveBeenCalledTimes(1);
});

test('does not infer missing indexes from constant WHERE conditions', async () => {
    const result = await assessQueryIndexes(db([{ table: 'readings', type: 'ALL', rows: 50000 }]), row, 'SELECT * FROM readings WHERE 1 = 1');
    expect(result.status).toBe('scan_without_filter');
});

test('does not return a partial healthy assessment for unmapped plan tables', async () => {
    const result = await assessQueryIndexes(db([{ table: 'unmapped', type: 'ref', key: 'idx_sensor', rows: 1 }]), row, sample);
    expect(result.status).toBe('inconclusive');
});

test('unqualified join predicates do not become speculative index recommendations', async () => {
    const result = await assessQueryIndexes(db([
        { table: 'a', type: 'ALL', rows: 50000 },
        { table: 'b', type: 'ALL', rows: 50000 },
    ]), row, 'SELECT a.id FROM readings a JOIN sensors b ON sensor_id = id');
    expect(result.status).toBe('inconclusive');
});

test('redacts database errors that might contain sample literal values', async () => {
    const connection = db();
    connection.query.mockRejectedValueOnce(Object.assign(new Error('secret value 42'), { code: 'ER_ACCESS_DENIED_ERROR' }));
    const result = await assessQueryIndexes(connection, row, sample);
    expect(result.status).toBe('inconclusive');
    expect(result.summary).not.toContain('secret value');
});

test('falls back to history on older servers and assesses each digest once', async () => {
    const connection = db();
    const original = connection.query.getMockImplementation();
    connection.query.mockImplementation(async (sql, params) => {
        if (sql.includes('QUERY_SAMPLE_TEXT')) throw Object.assign(new Error('Unknown column'), { code: 'ER_BAD_FIELD_ERROR' });
        if (sql.includes('events_statements_history_long')) return [[{ sample_sql: sample }]];
        return original(sql, params);
    });
    const rows = [{ ...row }, { ...row }];
    await assessPerformanceRows(connection, rows, []);
    expect(rows[0].indexAssessment.status).toBe('index_may_help');
    expect(rows[1].indexAssessment).toBe(rows[0].indexAssessment);
    expect(connection.query.mock.calls.filter(([sql]) => sql.startsWith('EXPLAIN'))).toHaveLength(1);
});

test('empty history produces an inconclusive assessment without attempting EXPLAIN', async () => {
    const connection = { query: jest.fn().mockResolvedValue([[]]) };
    const rows = [{ ...row }];
    const warnings = [];
    await assessPerformanceRows(connection, rows, warnings);
    expect(rows[0].indexAssessment.status).toBe('inconclusive');
    expect(warnings).toHaveLength(1);
    expect(connection.query.mock.calls.every(([sql]) => sql.startsWith('SELECT'))).toBe(true);
});

const nestedSample = "SELECT config_id, config_hash, NAME, datapoint, config_type FROM ControllerData.device_config WHERE config_hash IN (SELECT columnName FROM Alerts.AssetLinkHistory WHERE tableName LIKE 'E2%' AND END IS NULL)";

test('attributes unqualified predicates to the correct nested query block', () => {
    const parsed = inspectSample(nestedSample, 'Alerts');
    expect(parsed.tables).toEqual([
        { schema: 'ControllerData', name: 'device_config', alias: 'device_config' },
        { schema: 'Alerts', name: 'AssetLinkHistory', alias: 'AssetLinkHistory' },
    ]);
    expect([...parsed.conditionAliases]).toEqual(['device_config', 'AssetLinkHistory']);
    expect(parsed.hasSubqueries).toBe(true);
});

test('supports two nested IN predicates and qualified correlated EXISTS', () => {
    const nested = inspectSample('SELECT * FROM data_current WHERE config_id IN (SELECT config_id FROM device_config WHERE config_hash IN (SELECT columnName FROM AssetLinkHistory WHERE end IS NULL))', 'app');
    expect(nested.tables).toHaveLength(3);
    expect([...nested.conditionAliases]).toEqual(['data_current', 'device_config', 'AssetLinkHistory']);
    const correlated = inspectSample('SELECT r.id FROM readings r WHERE EXISTS (SELECT s.id FROM sensors s WHERE s.id = r.sensor_id)', 'app');
    expect([...correlated.conditionAliases].sort()).toEqual(['r', 's']);
});

test.each([
    'SELECT * FROM readings WHERE id IN (SELECT id FROM sensors',
    'SELECT * FROM readings WHERE id IN (SELECT id FROM sensors));',
    'SELECT * FROM readings WHERE id IN (SELECT id FROM information_schema.tables)',
    'SELECT * FROM readings WHERE id IN (SELECT app.side_effect(id) FROM sensors)',
    'SELECT * FROM readings WHERE id IN (SELECT id FROM sensors INTO OUTFILE \'/tmp/out\')',
])('rejects malformed or active nested samples: %s', sql => {
    expect(inspectSample(sql, 'app')).toBeNull();
});

test('maps materialized subqueries separately from base table indexes', async () => {
    const connection = db([
        { id: 1, table: 'device_config', type: 'ALL', key: null, rows: 50000, possible_keys: null },
        { id: 1, table: '<subquery2>', type: 'eq_ref', key: '<auto_distinct_key>', rows: 1 },
        { id: 2, table: 'AssetLinkHistory', type: 'ref', key: 'idx_end', rows: 500, possible_keys: 'idx_end' },
    ]);
    const result = await assessQueryIndexes(connection, row, nestedSample);
    expect(result.status).toBe('index_may_help');
    expect(result.tables.map(table => table.name)).toEqual(['device_config', 'AssetLinkHistory']);
    expect(result.tables[1].status).toBe('index_used');
    expect(result.notes.join(' ')).toMatch(/materializes/);
    expect(JSON.stringify(result)).not.toContain('E2%');
    expect(connection.query.mock.calls.filter(([sql]) => sql.startsWith('EXPLAIN'))[0][0]).toBe(`EXPLAIN FORMAT=TRADITIONAL ${nestedSample}`);
});

test('handles flattened semijoin aliases and annotates leading wildcards without revealing values', async () => {
    const sql = "SELECT d.config_id FROM ControllerData.device_config d WHERE d.config_hash IN (SELECT a.columnName FROM Alerts.AssetLinkHistory a WHERE a.tableName LIKE '%private-pattern%' AND a.end IS NULL)";
    const result = await assessQueryIndexes(db([
        { table: 'd', type: 'ref', key: 'idx_hash', rows: 10 },
        { table: 'a', type: 'ALL', rows: 10000 },
    ]), row, sql);
    expect(result.tables[1].reason).toMatch(/starts with a wildcard/);
    expect(result.tables[1].status).toBe('index_may_help');
    expect(JSON.stringify(result)).not.toContain('private-pattern');
});

test('does not assign inner predicates to an unfiltered outer table', async () => {
    const result = await assessQueryIndexes(db([
        { table: 'r', type: 'ALL', rows: 10000 },
        { table: 's', type: 'ALL', rows: 10000 },
    ]), row, 'SELECT r.id FROM readings r WHERE EXISTS (SELECT s.id FROM sensors s WHERE s.active = 1)');
    expect(result.tables[0].status).toBe('inconclusive');
    expect(result.tables[1].status).toBe('index_may_help');
});

test('does not speculate when an unqualified nested column could be a correlated reference', async () => {
    const connection = db();
    const result = await assessQueryIndexes(connection, row,
        'SELECT r.id FROM readings r WHERE EXISTS (SELECT s.id FROM sensors s WHERE outer_only_column = 1)');
    expect(result.status).toBe('inconclusive');
    expect(result.summary).toMatch(/unqualified predicate/);
    expect(connection.query.mock.calls.some(([sql]) => sql.startsWith('EXPLAIN'))).toBe(false);
});

test('skips backslash-escaped strings whose parsing depends on the sample session SQL mode', () => {
    const sql = "SELECT * FROM readings WHERE name = 'a" + String.fromCharCode(92) + "b'";
    expect(inspectSample(sql, 'app')).toBeNull();
});

test('validates SQL under NO_BACKSLASH_ESCAPES ambiguity before any metadata or EXPLAIN calls', async () => {
    const connection = db();
    const sql = "SELECT * FROM readings WHERE name = 'a" + String.fromCharCode(92) + "b'";
    expect((await assessQueryIndexes(connection, row, sql)).status).toBe('inconclusive');
    expect(connection.query).not.toHaveBeenCalled();
});
