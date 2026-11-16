import http from 'node:http';
import { once } from 'node:events';
import { startApiServer, setConfig } from '../src/socketServer';
import { DBStructureChecker } from '../src/DBStructureChecker';
import { compareAllDatabases } from '../src/compare';
import { applyDifferences, applyViewsAcrossDatabases } from '../src/apply';
import { dumpAllDatabases } from '../src/dump';
import { compare as compareModule, apply as applyModule } from '../src/index';

// HTTP requests exercise real Express routing. Every database action is mocked:
// no mysql2 connection is opened by this suite.
jest.mock('../src/DBStructureChecker', () => ({ DBStructureChecker: jest.fn() }));
jest.mock('../src/compare', () => ({ ...jest.requireActual('../src/compare'), compareAllDatabases: jest.fn() }));
jest.mock('../src/apply', () => ({ ...jest.requireActual('../src/apply'), applyDifferences: jest.fn(), applyViewsAcrossDatabases: jest.fn() }));
jest.mock('../src/dump', () => ({ dumpAllDatabases: jest.fn(), getDatabasesFromExistingDumps: jest.fn().mockResolvedValue([]) }));
jest.mock('../src/acceptCurrent', () => ({ acceptCurrentIntoTemplate: jest.fn() }));
jest.mock('../src/versions', () => ({ getVersionInfo: jest.fn().mockResolvedValue({ server: 'test' }), getServerVersion: jest.fn() }));
jest.mock('../src/performance', () => ({ checkPerformance: jest.fn() }));
jest.mock('../src/aiAnalysis', () => ({ analyzePerformanceQuery: jest.fn(), getAiStatus: jest.fn() }));
jest.mock('open', () => jest.fn());

let server, port, checker, log;
const defaults = { host: 'configured-host', user: 'configured-user', password: 'configured-password', output: 'C:\\mysqlsyncr-test-template' };
beforeAll(async () => {
    log = jest.spyOn(console, 'log').mockImplementation(() => {});
    server = startApiServer(0, defaults);
    await once(server, 'listening');
    port = server.address().port;
});
afterAll(async () => {
    if (server) await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    log?.mockRestore();
});
beforeEach(() => {
    jest.clearAllMocks();
    checker = { ready: jest.fn().mockResolvedValue(), closeConnection: jest.fn().mockResolvedValue(), connection: { query: jest.fn() } };
    DBStructureChecker.mockImplementation(() => checker);
    compareAllDatabases.mockResolvedValue({ app: [] });
    dumpAllDatabases.mockResolvedValue({ app: {} });
    applyDifferences.mockImplementation(async (_connection, _database, differences) => ({ attempted: differences.length, failures: [], warnings: [] }));
    applyViewsAcrossDatabases.mockImplementation(async (_connection, differences) => ({ attempted: Object.values(differences).flat().filter(d => d.type.endsWith('_view')).length, failures: [], warnings: [] }));
});

const post = (route, body = {}, headers = {}) => new Promise((resolve, reject) => {
    const json = JSON.stringify(body);
    const request = http.request({ host: '127.0.0.1', port, path: route, method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(json), Connection: 'close', ...headers } }, response => {
        const chunks = [];
        response.on('data', chunk => chunks.push(chunk));
        response.on('end', () => {
            const text = Buffer.concat(chunks).toString();
            try { resolve({ status: response.statusCode, headers: response.headers, body: JSON.parse(text) }); }
            catch (error) { reject(new Error(`Expected JSON (${response.statusCode}): ${text}`, { cause: error })); }
        });
    });
    request.on('error', reject);
    request.end(json);
});

test.each([null, [], 'invalid', 42, false])('rejects invalid config %p before opening a database connection', async config => {
    const response = await post('/api/compare', { config });
    expect(response.status).toBe(400);
    expect(response.body.message).toMatch(/config must be an object/);
    expect(DBStructureChecker).not.toHaveBeenCalled();
});

test('rejects array request bodies rather than acting on startup credentials', async () => {
    const response = await post('/api/dump', []);
    expect(response.status).toBe(400);
    expect(DBStructureChecker).not.toHaveBeenCalled();
});

test('explicit empty credentials and scope are not replaced by CLI defaults', async () => {
    const config = { host: '', user: '', password: '', database: '', output: '' };
    expect(setConfig(config, { ...defaults, database: 'default-db' })).toEqual(config);
    const response = await post('/api/compare', { config });
    expect(response.status).toBe(200);
    expect(DBStructureChecker).toHaveBeenCalledWith(config);
    expect(config.password).toBe('');
});

test('waits for ready, returns comparison metadata and closes exactly once', async () => {
    const order = [];
    checker.ready.mockImplementation(async () => { order.push('ready'); });
    compareAllDatabases.mockImplementation(async () => { order.push('compare'); return { app: [] }; });
    checker.closeConnection.mockImplementation(async () => { order.push('close'); });
    const response = await post('/api/compare', { config: { database: 'app' } });
    expect(response).toMatchObject({ status: 200, body: { app: [] } });
    expect(order).toEqual(['ready', 'compare', 'close']);
    expect(checker.closeConnection).toHaveBeenCalledTimes(1);
    expect(checker.connection.query).not.toHaveBeenCalled();
});

test.each(['authentication', 'metadata'])('returns 500 and closes once after %s failure', async stage => {
    const error = new Error(`${stage} failure`);
    if (stage === 'authentication') checker.ready.mockRejectedValueOnce(error);
    else compareAllDatabases.mockRejectedValueOnce(error);
    const response = await post('/api/compare', { config: {} });
    expect(response.status).toBe(500);
    expect(response.body.message).toBe(error.message);
    expect(checker.closeConnection).toHaveBeenCalledTimes(1);
    if (stage === 'authentication') expect(compareAllDatabases).not.toHaveBeenCalled();
});

test('a constructor exception becomes a JSON 500 response without an unhandled promise', async () => {
    DBStructureChecker.mockImplementationOnce(() => { throw new Error('Invalid connection setup'); });
    const response = await post('/api/compare', { config: {} });
    expect(response.status).toBe(500);
    expect(response.body.message).toBe('Invalid connection setup');
    expect(checker.closeConnection).not.toHaveBeenCalled();
});

test('a failure closing a connection is returned as 500 rather than claiming success', async () => {
    checker.closeConnection.mockRejectedValueOnce(new Error('Socket close failed'));
    const response = await post('/api/compare', { config: {} });
    expect(response.status).toBe(500);
    expect(response.body.message).toBe('Socket close failed');
    expect(checker.closeConnection).toHaveBeenCalledTimes(1);
});

test('retains the primary operation error when cleanup also fails', async () => {
    compareAllDatabases.mockRejectedValueOnce(new Error('Metadata unavailable'));
    checker.closeConnection.mockRejectedValueOnce(new Error('Socket close failed'));
    const response = await post('/api/compare', { config: {} });
    expect(response.status).toBe(500);
    expect(response.body.message).toBe('Metadata unavailable');
    expect(checker.closeConnection).toHaveBeenCalledTimes(1);
});

test.each(['compare', 'apply'])('module %s keeps its structured primary error when cleanup also fails', async operation => {
    checker.ready.mockRejectedValueOnce(new Error('Authentication failed'));
    checker.closeConnection.mockRejectedValueOnce(new Error('Socket close failed'));
    const promise = operation === 'compare' ? compareModule({}, defaults.output) : applyModule({}, 'app', []);
    await expect(promise).rejects.toMatchObject({ type: 'error', error: 'Authentication failed' });
    expect(checker.closeConnection).toHaveBeenCalledTimes(1);
});

test('dump passes the explicitly selected schema through to the exporter', async () => {
    const response = await post('/api/dump', { config: { database: 'old-scope' }, database: 'selected-scope' });
    expect(response.status).toBe(200);
    expect(dumpAllDatabases).toHaveBeenCalledWith(checker.connection, 'dump', expect.objectContaining({ database: 'selected-scope', output: defaults.output }));
    expect(checker.closeConnection).toHaveBeenCalledTimes(1);
});

test.each([
    {},
    { database: 'app', diffs: {} },
    { database: 'app', diffs: [null] },
    { database: 'app', diffs: [{ type: 1 }] },
])('rejects invalid apply payload before opening a connection: %p', async body => {
    expect((await post('/api/apply', body)).status).toBe(400);
    expect(DBStructureChecker).not.toHaveBeenCalled();
});

test('apply returns individual failures and warnings without claiming success', async () => {
    const failure = { type: 'missing_table', description: 'table app.t', message: 'Creation failed' };
    applyDifferences.mockResolvedValueOnce({ attempted: 1, failures: [failure], warnings: [{ message: 'Warning' }] });
    const response = await post('/api/apply', { database: 'app', diffs: [{ type: 'missing_table' }] });
    expect(response.status).toBe(500);
    expect(response.body.failures).toEqual([failure]);
    expect(response.body.warnings).toEqual([{ message: 'Warning' }]);
    expect(checker.closeConnection).toHaveBeenCalledTimes(1);
});

test('applyAll rejects a database outside the selected scope before connecting', async () => {
    const response = await post('/api/applyAll', { config: { database: 'selected' }, differences: { other: [{ type: 'missing_table' }] } });
    expect(response.status).toBe(400);
    expect(response.body.message).toMatch(/outside the selected scope/);
    expect(DBStructureChecker).not.toHaveBeenCalled();
});

test('applyAll rejects a missing-database payload that names another schema inside the selected map', async () => {
    const response = await post('/api/applyAll', { config: { database: 'selected' },
        differences: { selected: [{ type: 'missing_database', database: 'other' }] } });
    expect(response.status).toBe(400);
    expect(DBStructureChecker).not.toHaveBeenCalled();
});

test('apply rejects a missing-database payload that names another schema', async () => {
    const response = await post('/api/apply', { database: 'selected', diffs: [{ type: 'missing_database', database: 'other' }] });
    expect(response.status).toBe(400);
    expect(DBStructureChecker).not.toHaveBeenCalled();
});

test('applyAll completes each dependency phase across both databases before the next phase', async () => {
    const types = ['missing_trigger', 'missing_row', 'missing_constraint', 'missing_table', 'missing_view', 'missing_procedure', 'missing_database', 'extra_constraint'];
    const differences = Object.fromEntries(['one', 'two'].map(database => [database, types.map(type => ({ type, database }))]));
    const response = await post('/api/applyAll', { config: { database: '' }, differences });
    expect(response.status).toBe(200);
    expect(response.body.attempted).toBe(16);
    expect(applyDifferences.mock.calls.map(([, database, batch]) => `${database}:${batch[0].type}`)).toEqual(
        ['missing_database', 'extra_constraint', 'missing_table', 'missing_constraint', 'missing_procedure', 'missing_trigger', 'missing_row']
            .flatMap(type => [`one:${type}`, `two:${type}`]));
    expect(applyViewsAcrossDatabases).toHaveBeenCalledWith(checker.connection, differences);
    const viewOrder = applyViewsAcrossDatabases.mock.invocationCallOrder[0];
    expect(viewOrder).toBeGreaterThan(applyDifferences.mock.invocationCallOrder[9]);
    expect(viewOrder).toBeLessThan(applyDifferences.mock.invocationCallOrder[10]);
    expect(checker.closeConnection).toHaveBeenCalledTimes(1);
});

test('applyAll stops before dependent phases after a table failure', async () => {
    applyDifferences.mockImplementation(async (_connection, database, batch) => ({ attempted: batch.length,
        failures: database === 'one' ? [{ description: 'table t', message: 'Failed' }] : [], warnings: [] }));
    const response = await post('/api/applyAll', { differences: {
        one: [{ type: 'missing_table' }, { type: 'missing_constraint' }],
        two: [{ type: 'missing_table' }, { type: 'missing_constraint' }],
    } });
    expect(response.status).toBe(500);
    expect(response.body.failures[0].database).toBe('one');
    expect(applyDifferences.mock.calls.flatMap(([, , batch]) => batch.map(diff => diff.type))).toEqual(['missing_table', 'missing_table']);
    expect(checker.closeConnection).toHaveBeenCalledTimes(1);
});

test('binds to loopback by default', () => {
    expect(server.address().address).toBe('127.0.0.1');
});

test.each(['https://untrusted.example', 'null'])('rejects cross-origin request %s before any database connection', async origin => {
    const response = await post('/api/compare', { config: {} }, { Origin: origin });
    expect(response.status).toBe(403);
    expect(DBStructureChecker).not.toHaveBeenCalled();
});

test('accepts same-origin requests', async () => {
    const response = await post('/api/compare', { config: {} }, { Origin: `http://127.0.0.1:${port}` });
    expect(response.status).toBe(200);
    expect(DBStructureChecker).toHaveBeenCalledTimes(1);
});

test('rejects a matching attacker-controlled Host and Origin on the loopback listener', async () => {
    const authority = `attacker.example:${port}`;
    const response = await post('/api/compare', { config: {} }, { Host: authority, Origin: `http://${authority}` });
    expect(response.status).toBe(403);
    expect(DBStructureChecker).not.toHaveBeenCalled();
});
