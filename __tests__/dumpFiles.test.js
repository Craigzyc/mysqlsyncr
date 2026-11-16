import fs from 'fs/promises';
import path from 'path';
import { getDatabaseDumpNames } from '../src/dumpFiles';
import { getDatabasesFromExistingDumps } from '../src/dump';
import { compareAllDatabases } from '../src/compare';
import { getDatabases } from '../src/getters';

jest.mock('../src/getters', () => ({ getDatabases: jest.fn().mockResolvedValue([]), getDatabaseStructure: jest.fn() }));

let folder;
beforeEach(async () => {
    await fs.mkdir(path.join(process.cwd(), '.temp'), { recursive: true });
    folder = await fs.mkdtemp(path.join(process.cwd(), '.temp', 'dump-scan-'));
    await fs.writeFile(path.join(folder, 'syncOptions.json'), '{}');
    await fs.writeFile(path.join(folder, 'diffs.json'), '{}');
    await fs.writeFile(path.join(folder, 'dumpInfo.json'), '{}');
    await fs.mkdir(path.join(folder, 'unrelated'));
    await fs.mkdir(path.join(folder, 'app'));
    await fs.writeFile(path.join(folder, 'app', 'app.json'), '{"tables":{}}');
});

afterEach(async () => {
    if (!folder) return;
    if (path.dirname(path.resolve(folder)) !== path.resolve(process.cwd(), '.temp')) {
        throw new Error('Test cleanup must stay inside the workspace .temp directory.');
    }
    await fs.rm(folder, { recursive: true, force: true });
});

test('only matching dump directories are returned, ignoring syncOptions.json', async () => {
    expect(await getDatabaseDumpNames(folder)).toEqual(['app']);
    expect(await getDatabasesFromExistingDumps({ output: folder })).toEqual({ app: { tables: {} } });
});

test('comparison never proposes creating databases for config files or unrelated folders', async () => {
    const connection = { state: 'connected', query: jest.fn() };
    const diffs = await compareAllDatabases(connection, folder, false, 'compare', {});
    expect(Object.keys(diffs)).toEqual(['app']);
    expect(diffs.app[0].type).toBe('missing_database');
    expect(getDatabases).toHaveBeenCalledWith(connection);
    expect(connection.query).not.toHaveBeenCalled();
});

test('malformed dump JSON propagates an error for the API handler to report', async () => {
    await fs.writeFile(path.join(folder, 'app', 'app.json'), '{broken');
    await expect(getDatabasesFromExistingDumps({ output: folder })).rejects.toThrow(SyntaxError);
});
