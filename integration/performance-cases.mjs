import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { collectPerformanceReport } from '../src/performance.js';
import { collectDuplicateIndexes } from '../src/duplicateIndexes.js';
import { assessQueryIndexes } from '../src/indexAssessment.js';
import { collectAiContext, requestAiAnalysis } from '../src/aiAnalysis.js';

const schema = 'mysqlsyncr_perf_test';
const emptySchema = 'mysqlsyncr_perf_empty';

// Called only by the Docker integration harness after it verifies container
// ownership. Auxiliary connections come from the same verified factory.
export async function runPerformanceCases(connection, context = {}) {
    assert.equal(typeof context.createConnection, 'function', 'A verified Docker connection factory is required');
    const started = performance.now();
    const cases = [];
    const run = async (name, fn) => {
        const began = performance.now();
        try { await fn(); }
        catch (error) { error.message = `Performance case "${name}": ${error.message}`; throw error; }
        cases.push({ name, milliseconds: Math.round(performance.now() - began) });
    };
    const [[{ version }]] = await connection.query('SELECT @@version AS version');
    const mysql8 = Number(version.split('.')[0]) >= 8;
    const options = { database: schema, slowMs: 1000, minExecutions: 2, minRowsExamined: 1, limit: 20 };
    const consumerNames = ['statements_digest', 'events_statements_current', 'events_statements_history_long'];
    const [consumers] = await connection.query('SELECT NAME, ENABLED FROM performance_schema.setup_consumers WHERE NAME IN (?)', [consumerNames]);
    await connection.query('UPDATE performance_schema.setup_consumers SET ENABLED = ? WHERE NAME IN (?)', ['YES', consumerNames]);
    try {
        await run('create isolated workload fixtures', async () => {
            await connection.query(`DROP DATABASE IF EXISTS ${schema}`);
            await connection.query(`DROP DATABASE IF EXISTS ${emptySchema}`);
            await connection.query(`CREATE DATABASE ${schema}`);
            await connection.query(`CREATE DATABASE ${emptySchema}`);
            await connection.query(`USE ${schema}`);
            await connection.query('CREATE TABLE probe (id INT PRIMARY KEY, sensor_id INT NOT NULL, reading INT, name VARCHAR(64)) ENGINE=InnoDB');
            const rows = Array.from({ length: 3000 }, (_, i) => [i + 1, i % 100, i, `sensor-${i % 100}`]);
            await connection.query('INSERT INTO probe (id, sensor_id, reading, name) VALUES ?', [rows]);
            await connection.query('ANALYZE TABLE probe');
        });

        await run('distinguish a missing lookup index from an indexed plan', async () => {
            const row = { database_name: schema, digest: 'fixture' };
            const sql = 'SELECT id FROM probe WHERE sensor_id = 17';
            const before = await assessQueryIndexes(connection, row, sql);
            assert.equal(before.status, 'index_may_help', JSON.stringify(before));
            await connection.query('ALTER TABLE probe ADD INDEX idx_sensor (sensor_id)');
            const after = await assessQueryIndexes(connection, row, sql);
            assert.equal(after.status, 'index_used', JSON.stringify(after));
            assert.equal(after.tables[0].chosenIndex, 'idx_sensor');
            await connection.query('ALTER TABLE probe DROP INDEX idx_sensor');
        });

        await run('duplicate indexes respect uniqueness, prefix lengths, direction and visibility', async () => {
            await connection.query('CREATE TABLE duplicate_probe (id INT PRIMARY KEY, a INT, b INT, name VARCHAR(64), KEY id_copy (id), UNIQUE KEY unique_a (a), KEY plain_a (a), KEY name_short (name(10)), KEY name_long (name(20))) ENGINE=InnoDB');
            await connection.query('CREATE TABLE hash_probe (a INT, b INT, KEY hash_a (a) USING HASH, KEY hash_ab (a,b) USING HASH) ENGINE=MEMORY');
            if (mysql8) {
                await connection.query('CREATE TABLE direction_probe (a INT, b INT, KEY ascending_ab (a ASC,b ASC), KEY mixed_ab (a ASC,b DESC)) ENGINE=InnoDB');
                await connection.query('CREATE TABLE visibility_probe (a INT, KEY a_invisible (a) INVISIBLE, KEY z_visible (a) VISIBLE) ENGINE=InnoDB');
            }
            const findings = await collectDuplicateIndexes(connection, schema);
            assert(findings.some(row => row.index_name === 'id_copy' && row.covered_by === 'PRIMARY'));
            assert(findings.some(row => row.index_name === 'plain_a' && row.covered_by === 'unique_a'));
            assert(!findings.some(row => ['unique_a', 'name_short', 'name_long'].includes(row.index_name)));
            assert(!findings.some(row => row.table_name === 'hash_probe'));
            if (mysql8) {
                assert(!findings.some(row => row.table_name === 'direction_probe'));
                assert(findings.some(row => row.table_name === 'visibility_probe' && row.index_name === 'a_invisible' && row.covered_by === 'z_visible'));
                assert(!findings.some(row => row.index_name === 'z_visible'));
            }
        });

        let baseline;
        const slowWorkload = 'SELECT id FROM probe WHERE sensor_id = 17 AND SLEEP(1.1) = 0 LIMIT 1';
        await run('cumulative slow queries and scans use actual workload counters', async () => {
            await connection.query(slowWorkload);
            await connection.query(slowWorkload);
            baseline = await collectPerformanceReport(connection, options);
            assert.equal(baseline.available, true);
            assert.equal(baseline.duplicateIndexesAvailable, true);
            const slow = baseline.slowQueries.find(row => /SLEEP/i.test(row.query_text) && /probe/i.test(row.query_text));
            assert(slow, JSON.stringify(baseline.warnings));
            assert(Number(slow.execution_count) >= 2);
            assert(Number(slow.max_ms) > 1000);
            assert.equal(slow.indexAssessment.status, 'inconclusive', 'Function samples must never execute during automatic EXPLAIN');
            assert(baseline.indexCandidates.some(row => row.digest === slow.digest));
            assert(baseline.snapshotId);
        });

        await run('interval snapshots subtract lifetime counters', async () => {
            await connection.query(slowWorkload);
            await connection.query(slowWorkload);
            const report = await collectPerformanceReport(connection, { ...options, baselineId: baseline.snapshotId });
            assert.equal(report.interval.available, true, report.interval.message);
            const interval = report.interval.rows.find(row => /SLEEP/i.test(row.query_text) && /probe/i.test(row.query_text));
            assert(interval, report.interval.message);
            assert.equal(interval.execution_count, 2);
            assert(interval.avg_ms > 1000);
            assert.equal(interval.max_ms, null);
        });

        await run('empty or disabled digest coverage never reports clean query health', async () => {
            const empty = await collectPerformanceReport(connection, { ...options, database: emptySchema });
            assert.equal(empty.digestCoverage.count, 0);
            for (const area of ['Slow queries', 'Needed indexes']) assert.equal(empty.notifications.find(row => row.area === area).status, 'unknown');
            await connection.query("UPDATE performance_schema.setup_consumers SET ENABLED = 'NO' WHERE NAME = 'statements_digest'");
            try {
                const disabled = await collectPerformanceReport(connection, { ...options, database: emptySchema });
                assert.equal(disabled.digestCoverage.complete, false);
                assert(disabled.warnings.some(warning => warning.includes('consumer is disabled')));
            } finally {
                await connection.query("UPDATE performance_schema.setup_consumers SET ENABLED = 'YES' WHERE NAME = 'statements_digest'");
            }
        });

        await run('blocking transactions appear on both MySQL lock-table implementations', async () => {
            const blocker = await context.createConnection();
            const waiter = await context.createConnection();
            let pending;
            try {
                await blocker.query(`USE ${schema}`);
                await waiter.query(`USE ${schema}`);
                const [[{ id: blockerId }]] = await blocker.query('SELECT CONNECTION_ID() AS id');
                const [[{ id: waiterId }]] = await waiter.query('SELECT CONNECTION_ID() AS id');
                await blocker.beginTransaction();
                await blocker.query('UPDATE probe SET reading = reading + 1 WHERE id = 1');
                await waiter.beginTransaction();
                pending = waiter.query('UPDATE probe SET reading = reading + 1 WHERE id = 1').then(() => null, error => error);
                await delay(2200);
                const report = await collectPerformanceReport(connection, options);
                assert.equal(report.diagnostics.lockWaits.available, true, JSON.stringify(report.warnings));
                assert(report.diagnostics.lockWaits.rows.some(row => Number(row.waiting_pid) === waiterId && Number(row.blocking_pid) === blockerId), JSON.stringify(report.diagnostics.lockWaits));
                assert.equal(report.serverHealth.lockContention.status, 'critical');
            } finally {
                await blocker.rollback();
                if (pending) assert.equal(await pending, null);
                await waiter.rollback();
                await Promise.all([blocker.end(), waiter.end()]);
            }
        });

        await run('live queries include elapsed time without exposing literal SQL', async () => {
            const worker = await context.createConnection();
            let pending;
            try {
                await worker.query(`USE ${schema}`);
                const [[{ id }]] = await worker.query('SELECT CONNECTION_ID() AS id');
                pending = worker.query('SELECT SLEEP(4)').then(() => null, error => error);
                await delay(1300);
                const report = await collectPerformanceReport(connection, options);
                assert.equal(report.diagnostics.liveQueries.available, true, JSON.stringify(report.warnings));
                const live = report.diagnostics.liveQueries.rows.find(row => Number(row.connection_id) === id);
                assert(live, JSON.stringify(report.diagnostics.liveQueries));
                assert(Number(live.elapsed_seconds) > 1);
                assert(!/SLEEP\s*\(\s*4/.test(live.query_text));
            } finally {
                if (pending) assert.equal(await pending, null);
                await worker.end();
            }
        });

        await run('AI context redacts sample literals and uses a mock provider only', async () => {
            await connection.query(`USE ${schema}`);
            const privateValue = 'mysqlsyncr-private-literal';
            await connection.query('SELECT id FROM probe WHERE name = ?', [privateValue]);
            const [digests] = await connection.query(`SELECT DIGEST FROM performance_schema.events_statements_summary_by_digest
                WHERE SCHEMA_NAME = ? AND DIGEST_TEXT LIKE '%probe%' AND DIGEST_TEXT LIKE '%name%' AND DIGEST_TEXT NOT LIKE '%SLEEP%' ORDER BY LAST_SEEN DESC`, [schema]);
            assert(digests.length);
            const aiContext = await collectAiContext(connection, schema, digests[0].DIGEST);
            assert(!JSON.stringify(aiContext).includes(privateValue));
            const analysis = { summary: 'Mock provider validation.', bottlenecks: [], indexSuggestions: [], querySuggestions: [], verification: [], limitations: [] };
            let providerCalls = 0;
            const result = await requestAiAnalysis(aiContext, 'mysqlsyncr-test', async (_url, request) => {
                providerCalls++;
                assert(!request.body.includes(privateValue));
                return { ok: true, json: async () => ({ message: { content: JSON.stringify(analysis) } }) };
            });
            assert.equal(providerCalls, 1);
            assert.deepEqual(result.analysis, analysis);
        });
    } finally {
        for (const consumer of consumers) await connection.query('UPDATE performance_schema.setup_consumers SET ENABLED = ? WHERE NAME = ?', [consumer.ENABLED, consumer.NAME]);
    }
    return { version, cases, elapsedMs: Math.round(performance.now() - started) };
}
