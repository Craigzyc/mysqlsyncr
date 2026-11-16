import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { compareAllDatabases } from '../src/compare';
import { getDatabases, getDatabaseStructure } from '../src/getters';
import { applyDifferences } from '../src/apply';

jest.mock('../src/getters', () => ({ getDatabases: jest.fn(), getDatabaseStructure: jest.fn() }));
jest.mock('../src/apply', () => ({ applyDifferences: jest.fn(), describeFailures: r => `${r.failures.length} failed` }));
jest.mock('../src/versions', () => ({ ...jest.requireActual('../src/versions'), getServerVersion: jest.fn().mockResolvedValue('8.0.46') }));
jest.mock('../src/loggers', () => ({ logger: jest.fn(), logDifferences: jest.fn() }));
let folder;
const empty = () => ({ tables: {}, procedures: [], views: {} });
beforeEach(async () => {
    folder = await fs.mkdtemp(path.join(os.tmpdir(), 'mysqlsyncr-unit-'));
    getDatabases.mockResolvedValue([]);
    getDatabaseStructure.mockResolvedValue(empty());
    applyDifferences.mockReset().mockImplementation(async (connection, db, diffs) => ({ attempted: diffs.length, failures: [], warnings: [] }));
});
afterEach(async () => { await fs.rm(folder, { recursive: true, force: true }); });
async function manifest(name, value = empty()) {
    await fs.mkdir(path.join(folder, name), { recursive: true });
    await fs.writeFile(path.join(folder, name, `${name}.json`), typeof value === 'string' ? value : JSON.stringify(value));
}
const table = name => ({ columns: [{ Field: 'id', Type: 'int' }], indexes: [], triggers: [], createSQL: `CREATE TABLE \`${name}\` (\n  \`id\` int DEFAULT NULL\n) ENGINE=InnoDB` });
test('restores missing databases and their tables in the same invocation', async () => {
    await manifest('a', { tables: { t: table('t') } });
    const result = await compareAllDatabases({ query: jest.fn() }, folder, true, 'update', {});
    expect(result.a.map(d => d.type)).toEqual(expect.arrayContaining(['missing_database', 'missing_table']));
    expect(applyDifferences.mock.calls.flatMap(c => c[2]).map(d => d.type)).toContain('missing_table');
});
test('reads every manifest before mutating anything', async () => {
    await manifest('a', { tables: { t: table('t') } });
    await manifest('z', '{invalid');
    const connection = { query: jest.fn() };
    await expect(compareAllDatabases(connection, folder, true, 'update', {})).rejects.toThrow();
    expect(applyDifferences).not.toHaveBeenCalled();
    expect(connection.query).not.toHaveBeenCalled();
});
test('errors cannot masquerade as an empty comparison', async () => {
    await manifest('a');
    getDatabases.mockResolvedValue(['a']);
    getDatabaseStructure.mockRejectedValueOnce(new Error('metadata denied'));
    await expect(compareAllDatabases({}, folder, false, 'compare', {})).rejects.toThrow('metadata denied');
});
test('failed mutations reject with failures instead of reporting completion', async () => {
    await manifest('a');
    applyDifferences.mockResolvedValueOnce({ attempted: 1, failures: [{ type: 'missing_database', message: 'denied' }], warnings: [] });
    await expect(compareAllDatabases({}, folder, true, 'update', {})).rejects.toMatchObject({ failures: expect.any(Array) });
});
test('an empty or unmatched template scope is an error', async () => {
    await expect(compareAllDatabases({}, folder, false, 'compare', {})).rejects.toThrow(/template/i);
    await manifest('a');
    await expect(compareAllDatabases({}, folder, false, 'compare', { database: 'typo' })).rejects.toThrow(/typo/);
});
