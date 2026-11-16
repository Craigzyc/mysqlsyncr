import { collectAiContext, requestAiAnalysis } from '../src/aiAnalysis';

const digest = 'a'.repeat(64);
const analysis = { summary: 'Review the plan.', bottlenecks: [], indexSuggestions: ['Check selectivity first.'], querySuggestions: [], verification: ['Compare estimated plans.'], limitations: ['No plan available.'] };

test('collects nested-query metadata without executing the query or exposing sample literals', async () => {
    const connection = { query: jest.fn(async sql => {
        if (sql.includes('COUNT_STAR AS')) return [[{ database_name: 'app', digest, query_text: 'SELECT id FROM app.readings WHERE id IN (SELECT id FROM sensors WHERE secret = ?)', average_seconds: 0.00727 }]];
        if (sql.includes('QUERY_SAMPLE_TEXT')) return [[{ sample_sql: "SELECT id FROM readings WHERE id IN (SELECT id FROM sensors WHERE secret = 'private-value')" }]];
        if (sql.includes('information_schema.COLUMNS')) return [[{ COLUMN_NAME: 'id', COLUMN_TYPE: 'int', IS_NULLABLE: 'NO' }]];
        if (sql.includes('information_schema.STATISTICS')) return [[{ INDEX_NAME: 'PRIMARY', COLUMN_NAME: 'id', NON_UNIQUE: 0, SEQ_IN_INDEX: 1 }]];
        throw new Error('Unexpected query');
    }) };
    const context = await collectAiContext(connection, 'app', digest);
    expect(context.tables.map(table => table.name)).toEqual(['readings', 'sensors']);
    expect(context.query.average_seconds).toBe(0.00727);
    expect(context.query.indexAssessment.status).toBe('inconclusive');
    expect(JSON.stringify(context)).not.toContain('private-value');
    expect(connection.query.mock.calls.some(([sql]) => /^(CREATE|ALTER|UPDATE|DELETE|EXPLAIN ANALYZE)/.test(sql))).toBe(false);
});

test('rejects invalid digest before reading the database', async () => {
    const connection = { query: jest.fn() };
    await expect(collectAiContext(connection, 'app', 'anything')).rejects.toThrow('valid database and digest');
    expect(connection.query).not.toHaveBeenCalled();
});

test('uses local structured chat and returns only validated response fields', async () => {
    const fetchImpl = jest.fn(async () => ({ ok: true, json: async () => ({ message: { content: JSON.stringify({ ...analysis, arbitrary: 'ignored' }) } }) }));
    const result = await requestAiAnalysis({ query: { query_text: 'SELECT ?' } }, undefined, fetchImpl);
    expect(fetchImpl.mock.calls[0][0]).toBe('http://127.0.0.1:11434/api/chat');
    const body = JSON.parse(fetchImpl.mock.calls[0][1].body);
    expect(body).toMatchObject({ model: 'llama3.2:3b', stream: false, format: { type: 'object' } });
    expect(result.analysis).toEqual(analysis);
});

test.each(['not JSON', '{}', JSON.stringify({ ...analysis, verification: [42] })])('rejects malformed model output: %s', async content => {
    const fetchImpl = async () => ({ ok: true, json: async () => ({ message: { content } }) });
    await expect(requestAiAnalysis({}, undefined, fetchImpl)).rejects.toThrow(/invalid|incomplete/);
});

test('gives actionable missing-model and connection errors', async () => {
    await expect(requestAiAnalysis({}, undefined, async () => ({ ok: false, status: 404 }))).rejects.toThrow('ollama pull llama3.2:3b');
    await expect(requestAiAnalysis({}, undefined, async () => { throw new TypeError('fetch failed'); })).rejects.toThrow('Start Ollama');
});

test('rejects cloud model names before sending query context', async () => {
    const fetchImpl = jest.fn();
    await expect(requestAiAnalysis({}, 'some-model:cloud', fetchImpl)).rejects.toThrow('locally installed');
    expect(fetchImpl).not.toHaveBeenCalled();
});
