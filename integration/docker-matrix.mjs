import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import mysql from 'mysql2/promise';
import { compareAllDatabases } from '../src/compare.js';
import { dumpAllDatabases } from '../src/dump.js';
import { applyDifferences } from '../src/apply.js';
import { getDatabaseDumpNames } from '../src/dumpFiles.js';
import { parseCreateTableSQL } from '../src/parsers.js';
import { startApiServer } from '../src/socketServer.js';
import { once } from 'node:events';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const arg = name => args.includes(name) ? args[args.indexOf(name) + 1] : undefined;
const source = arg('--template');
if (!source) throw new Error('Usage: npm run test:integration -- --template /path/to/CAM/DBTemplate [--artifacts /path]');
const artifacts = path.resolve(arg('--artifacts') || await fs.mkdtemp(path.join(os.tmpdir(), 'mysqlsyncr-matrix-')));
await fs.mkdir(artifacts, { recursive: true });
const template = path.join(artifacts, 'cam-template');
await fs.cp(path.resolve(source), template, { recursive: true });
const schemas = await getDatabaseDumpNames(template);
const expected = Object.fromEntries(await Promise.all(schemas.map(async name => [name, JSON.parse(await fs.readFile(path.join(template, name, `${name}.json`), 'utf8'))])));
const expectedCounts = { databases: schemas.length, tables: 0, procedures: 0, views: 0, triggers: 0, foreignKeys: 0 };
for (const db of Object.values(expected)) {
    expectedCounts.tables += Object.keys(db.tables).length;
    expectedCounts.procedures += (db.procedures || []).length;
    expectedCounts.views += Object.keys(db.views || {}).length;
    for (const table of Object.values(db.tables)) {
        expectedCounts.triggers += (table.triggers || []).length;
        expectedCounts.foreignKeys += parseCreateTableSQL(table.createSQL).constraints.length;
    }
}
const hash = async dir => {
    const digest = createHash('sha256');
    for (const entry of (await fs.readdir(dir, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
        digest.update(entry.name);
        digest.update(entry.isDirectory() ? await hash(path.join(dir, entry.name)) : await fs.readFile(path.join(dir, entry.name)));
    }
    return digest.digest('hex');
};
const sourceHash = await hash(path.resolve(source));
const docker = (...argv) => execFileSync('docker', argv, { encoding: 'utf8', timeout: 180000 }).trim();
const identifier = name => '`' + String(name).replace(/`/g, '``') + '`';
const count = diffs => Object.values(diffs).reduce((n, entries) => n + entries.length, 0);
const quiet = async fn => {
    const saved = console.log;
    console.log = () => {};
    try { return await fn(); } finally { console.log = saved; }
};
const summary = { startedAt: new Date().toISOString(), template: path.basename(path.resolve(source)), sourceHash, expectedCounts, versions: [] };
const instances = [];
async function cleanComparison(connection, folder = template, options = {}) {
    const diffs = await compareAllDatabases(connection, folder, false, 'compare', { quiet: true, ...options });
    if (count(diffs)) await fs.writeFile(path.join(artifacts, 'remaining-differences.json'), JSON.stringify(diffs, null, 2));
    assert.equal(count(diffs), 0, `Expected a clean comparison: ${JSON.stringify(Object.fromEntries(Object.entries(diffs).filter(([, d]) => d.length).map(([db, d]) => [db, d.slice(0, 3)])))}`);
}
async function repair(connection, folder = template, options = {}) {
    const differences = await quiet(() => compareAllDatabases(connection, folder, true, 'update', { quiet: true, ...options }));
    await cleanComparison(connection, folder, options);
    return count(differences);
}
async function inventory(connection) {
    const placeholders = schemas.map(() => '?').join(',');
    const rows = async sql => Number((await connection.query(sql, schemas))[0].n);
    return {
        databases: await rows(`SELECT COUNT(*) n FROM information_schema.SCHEMATA WHERE SCHEMA_NAME IN (${placeholders})`),
        tables: await rows(`SELECT COUNT(*) n FROM information_schema.TABLES WHERE TABLE_TYPE='BASE TABLE' AND TABLE_SCHEMA IN (${placeholders})`),
        views: await rows(`SELECT COUNT(*) n FROM information_schema.TABLES WHERE TABLE_TYPE='VIEW' AND TABLE_SCHEMA IN (${placeholders})`),
        procedures: await rows(`SELECT COUNT(*) n FROM information_schema.ROUTINES WHERE ROUTINE_TYPE='PROCEDURE' AND ROUTINE_SCHEMA IN (${placeholders})`),
        triggers: await rows(`SELECT COUNT(*) n FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA IN (${placeholders})`),
        foreignKeys: await rows(`SELECT COUNT(*) n FROM information_schema.REFERENTIAL_CONSTRAINTS WHERE CONSTRAINT_SCHEMA IN (${placeholders})`),
    };
}
async function mutationCases(connection) {
    const results = [];
    const run = async (name, mutate, verify = async () => {}) => {
        await mutate();
        const differences = await compareAllDatabases(connection, template, false, 'compare', { quiet: true });
        assert.ok(count(differences) > 0, `${name}: mutation was invisible`);
        await repair(connection);
        await verify();
        results.push({ name, detectedDifferences: count(differences) });
    };
    await connection.query('INSERT INTO SystemLog.SystemLog (id,username,event,priority) VALUES (900001,?,?,3)', ['test user', "retained 'quoted' value"]);
    const retained = () => connection.query('SELECT id,username,event,priority FROM SystemLog.SystemLog WHERE id=900001');
    const before = await retained();
    await run('column type, default, comment, order, missing and extra columns', async () => {
        await connection.query('ALTER TABLE SystemLog.SystemLog MODIFY username varchar(90) DEFAULT NULL COMMENT \'drift\' AFTER priority, MODIFY priority bigint DEFAULT 2, DROP COLUMN event_type, ADD COLUMN unexpected int');
    }, async () => assert.deepEqual(await retained(), before));
    await run('reversed composite index', () => connection.query('ALTER TABLE ControllerData.device_meta DROP INDEX config, ADD INDEX config (property,config_id)'));
    await run('missing AUTO_INCREMENT and primary key', () => connection.query('ALTER TABLE testuserdb.PasswordReset MODIFY idPasswordReset int NOT NULL, DROP PRIMARY KEY'));
    await run('missing table', () => connection.query('DROP TABLE testuserdb.PasswordReset'));
    await run('extra table', () => connection.query('CREATE TABLE SystemLog.mysqlsyncr_unexpected (id int)'));
    const fk = parseCreateTableSQL(expected.Alerts.tables.Assets.createSQL).constraints[0];
    await run('missing foreign key', () => connection.query(`ALTER TABLE Alerts.Assets DROP FOREIGN KEY ${identifier(fk.Name)}`));
    const procedure = expected.SystemLog.procedures[0];
    await run('missing procedure', () => connection.query(`DROP PROCEDURE SystemLog.${identifier(procedure.Name)}`));
    const view = Object.keys(expected.IoT.views)[0];
    await run('changed view', () => connection.query(`CREATE OR REPLACE VIEW IoT.${identifier(view)} AS SELECT 42 AS seq`));
    const triggerTable = Object.entries(expected.Alerts.tables).find(([, table]) => table.triggers?.length);
    await run('missing trigger', () => connection.query(`DROP TRIGGER Alerts.${identifier(triggerTable[1].triggers[0].Name)}`));
    await run('missing database', () => connection.query('DROP DATABASE testuserdb'));
    assert.deepEqual(await retained(), before, 'unrelated CAM data must survive all repairs');
    await connection.query('DELETE FROM SystemLog.SystemLog WHERE id=900001');
    return results;
}

async function interfaceCases(connection, config, version, tag) {
    const cases = [];
    const fixture = path.join(artifacts, `seeds-${tag}`);
    await fs.mkdir(fixture, { recursive: true });
    await fs.cp(path.join(template, 'SystemLog'), path.join(fixture, 'SystemLog'), { recursive: true });
    await fs.writeFile(path.join(fixture, 'syncOptions.json'), JSON.stringify({ databases: { SystemLog: { SystemLog: {
        rowKey: ['id'], rows: [{ id: 900002, username: 'seed user', event: 'seed value', priority: 3 }]
    } } } }));
    await repair(connection, fixture);
    assert.equal((await connection.query('SELECT COUNT(*) n FROM SystemLog.SystemLog WHERE id=900002'))[0].n, 1);
    await connection.query("UPDATE SystemLog.SystemLog SET event='operator edited' WHERE id=900002");
    assert.equal(await repair(connection, fixture), 0);
    assert.equal((await connection.query('SELECT event FROM SystemLog.SystemLog WHERE id=900002'))[0].event, 'operator edited');
    cases.push({ name: 'seed insertion is idempotent and preserves existing keyed rows' });
    const scopedDump = path.join(artifacts, `scoped-${tag}`);
    await fs.mkdir(scopedDump, { recursive: true });
    assert.deepEqual(Object.keys(await dumpAllDatabases(connection, 'dump', { output: scopedDump, database: 'SystemLog' })), ['SystemLog']);
    assert.deepEqual(await getDatabaseDumpNames(scopedDump), ['SystemLog']);
    cases.push({ name: 'database-scoped dump excludes other schemas' });
    const cli = (command, extra = [], entry = 'src/index.js', password = config.password) => spawnSync(process.execPath,
        [entry, command, '--host', config.host, '--port', String(config.port), '--user', config.user,
            '--password', password, '--output', template, ...extra],
        { cwd: root, encoding: 'utf8', timeout: 120000, maxBuffer: 12 * 1024 * 1024 });
    for (const entry of ['src/index.js', 'dist/index.cjs']) {
        const result = cli('update', ['--database', 'SystemLog'], entry);
        assert.equal(result.status, 0, result.stderr || result.error?.message);
        assert.match(result.stdout, /Remaining differences after verification: 0/);
    }
    assert.equal(cli('compare', ['--database', 'missing-template-scope']).status, 1);
    assert.equal(cli('compare', [], 'src/index.js', 'incorrect-test-password').status, 1);
    cases.push({ name: 'source and packaged CLI success, unknown scope and failed authentication exit codes' });
    const server = startApiServer(0, {});
    try {
        await once(server, 'listening');
        const base = `http://127.0.0.1:${server.address().port}`;
        const apiConfig = { ...config, output: template, database: 'SystemLog' };
        const post = async (route, body) => {
            const response = await fetch(base + route, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
            return { status: response.status, body: await response.json() };
        };
        const versions = await post('/api/versions', { config: apiConfig });
        assert.equal(versions.status, 200);
        assert.equal(versions.body.server, version);
        await connection.query('ALTER TABLE SystemLog.SystemLog MODIFY username varchar(90) DEFAULT NULL');
        const comparison = await post('/api/compare', { config: apiConfig });
        assert.equal(comparison.status, 200);
        assert.deepEqual(Object.keys(comparison.body), ['SystemLog']);
        assert.ok(count(comparison.body));
        const applied = await post('/api/applyAll', { config: apiConfig, differences: comparison.body });
        assert.equal(applied.status, 200, JSON.stringify(applied.body));
        assert.equal(count((await post('/api/compare', { config: apiConfig })).body), 0);
        const failure = await post('/api/apply', { config: apiConfig, database: 'SystemLog', diffs: [{ type: 'unsupported_test_difference' }] });
        assert.equal(failure.status, 500);
        assert.equal(failure.body.failures.length, 1);
        const auth = await post('/api/compare', { config: { ...apiConfig, password: 'incorrect-test-password' } });
        assert.equal(auth.status, 500);
        assert.match(auth.body.message, /Access denied/);
        assert.equal((await post('/api/compare', { config: apiConfig })).status, 200, 'server must remain usable after failures');
        cases.push({ name: 'live API versions, scoped comparison, bulk repair, partial failure and authentication recovery' });
    } finally {
        await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    }
    await connection.query('DELETE FROM SystemLog.SystemLog WHERE id=900002');
    return cases;
}

for (const tag of (arg('--only') ? [arg('--only')] : ['57', '80'])) {
    const reused = args.includes('--reuse');
    const name = reused ? `mysqlsyncr-validation-${tag}` : `mysqlsyncr-matrix-${tag}-${Date.now()}`;
    let connection;
    const record = { tag, tests: [], status: 'running' };
    summary.versions.push(record);
    try {
        if (!reused) docker('run', '--detach', '--name', name, '--label', 'mysqlsyncr.validation=20261116', '--publish', '127.0.0.1::3306', '--env', 'MYSQL_ROOT_PASSWORD=mysqlsyncr-test-only', '--env', 'MYSQL_ROOT_HOST=%', tag === '57' ? 'mysql:5.7' : 'mysql:8.0', '--performance-schema=ON');
        const info = JSON.parse(docker('inspect', name))[0];
        assert.equal(info.Config.Labels['mysqlsyncr.validation'], '20261116', 'Refusing a container not owned by this test harness');
        const binding = info.NetworkSettings.Ports['3306/tcp'][0];
        assert.equal(binding.HostIp, '127.0.0.1', 'Test DB must be bound to loopback');
        record.container = name;
        record.image = info.Image;
        const config = { host: '127.0.0.1', port: Number(binding.HostPort), user: 'root', password: 'mysqlsyncr-test-only', connectTimeout: 5000 };
        instances.push({ name, reused, config, record });
        for (let attempt = 0; attempt < 60; attempt++) {
            try { connection = await mysql.createConnection(config); break; }
            catch (error) { if (attempt === 59) throw error; await new Promise(resolve => setTimeout(resolve, 1000)); }
        }
        const [[server]] = await connection.query('SELECT @@version AS version, @@sql_mode AS sqlMode');
        record.version = server.version;
        record.sqlMode = server.sqlMode;
        assert.ok(server.version.startsWith(tag === '57' ? '5.7.' : '8.0.'));
        const adapter = { query: async (...query) => (await connection.query(...query))[0] };
        console.log(`${server.version}: restoring ${expectedCounts.tables} CAM tables from empty databases`);
        // The explicit Docker ownership/loopback checks above guard every reset.
        await connection.query('SET SESSION FOREIGN_KEY_CHECKS=0');
        for (const schema of schemas) await connection.query(`DROP DATABASE IF EXISTS ${identifier(schema)}`);
        await connection.query('SET SESSION FOREIGN_KEY_CHECKS=1');
        const started = Date.now();
        const restored = await repair(adapter);
        record.restoreMs = Date.now() - started;
        record.inventory = await inventory(adapter);
        assert.deepEqual(record.inventory, expectedCounts);
        record.tests.push({ name: 'full CAM restore, independent inventory and zero-diff verification', differences: restored });
        assert.equal(await repair(adapter), 0, 'second update must be a no-op');
        record.tests.push({ name: 'idempotent second update' });
        console.log(`${server.version}: full restore and idempotency passed in ${record.restoreMs}ms`);
        if (!args.includes('--restore-only')) {
            record.tests.push(...await mutationCases(adapter));
            record.tests.push(...await interfaceCases(adapter, config, server.version, tag));
            const dump = path.join(artifacts, `dump-${tag}`);
            await fs.mkdir(dump, { recursive: true });
            const dumped = await dumpAllDatabases(adapter, 'dump', { output: dump });
            // Performance fixtures from another run are intentionally outside CAM.
            for (const name of Object.keys(dumped).filter(name => !schemas.includes(name))) await fs.rm(path.join(dump, name), { recursive: true });
            await cleanComparison(adapter, dump);
            record.dump = dump;
            record.tests.push({ name: 'dump round trip with all CAM objects' });
            if (!args.includes('--skip-performance')) {
                const { runPerformanceCases } = await import('./performance-cases.mjs');
                record.performance = await runPerformanceCases(connection, { version: server.version, createConnection: () => mysql.createConnection(config) });
            }
            if (!args.includes('--skip-engine')) {
                // This fixed fixture belongs to this harness on the verified container.
                await connection.query('DROP DATABASE IF EXISTS mysqlsyncr_engine_test');
                const { runEngineCases } = await import('./engine-cases.mjs');
                record.engine = await quiet(() => runEngineCases(connection, { version: server.version }));
            }
        }
        record.status = 'passed';
        console.log(`${server.version}: ${record.tests.length} matrix cases passed`);
    } catch (error) {
        record.status = 'failed';
        record.error = { message: error.message, stack: error.stack, failures: error.failures, warnings: error.warnings };
        console.error(`${tag}: ${error.message}`);
        process.exitCode = 1;
    } finally {
        try { await connection?.end(); } catch (error) { record.closeError = error.message; process.exitCode = 1; }
        await fs.writeFile(path.join(artifacts, 'summary.json'), JSON.stringify(summary, (key, value) => key === 'dump' ? path.basename(value) : value, 2));
    }
}
if (!args.includes('--restore-only') && instances.length === 2 && instances.every(i => i.record.status === 'passed')) {
    summary.crossVersion = [];
    for (const target of instances) {
        const source = instances.find(i => i !== target);
        const connection = await mysql.createConnection(target.config);
        const adapter = { query: async (...query) => (await connection.query(...query))[0] };
        try {
            console.log(`Restoring ${source.record.version} dump on ${target.record.version}`);
            await connection.query('SET SESSION FOREIGN_KEY_CHECKS=0');
            for (const schema of schemas) await connection.query(`DROP DATABASE IF EXISTS ${identifier(schema)}`);
            await connection.query('SET SESSION FOREIGN_KEY_CHECKS=1');
            await repair(adapter, source.record.dump);
            assert.deepEqual(await inventory(adapter), expectedCounts);
            await cleanComparison(adapter, source.record.dump);
            summary.crossVersion.push({ from: source.record.version, to: target.record.version, status: 'passed' });
        } catch (error) {
            summary.crossVersion.push({ from: source.record.version, to: target.record.version, status: 'failed', error: error.message });
            process.exitCode = 1;
        } finally { await connection.end(); }
    }
}
for (const instance of instances) if (!instance.reused) docker('rm', '--force', '--volumes', instance.name);
summary.finishedAt = new Date().toISOString();
await fs.writeFile(path.join(artifacts, 'summary.json'), JSON.stringify(summary, (key, value) => key === 'dump' ? path.basename(value) : value, 2));
assert.equal(await hash(path.resolve(source)), sourceHash, 'Source CAM template changed during validation');
console.log(`Evidence: ${path.join(artifacts, 'summary.json')}`);
