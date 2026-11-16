import assert from 'node:assert/strict';
import { getDatabaseStructure } from '../src/getters.js';
import { findDifferences } from '../src/differences.js';
import { applyDifferences } from '../src/apply.js';
import { applyAllDifferences } from '../src/compare.js';

// The caller owns and validates the disposable Docker connection. This module
// never opens a connection and never reads credentials or application settings.
export async function runEngineCases(promiseConnection, { version } = {}) {
    const database = 'mysqlsyncr_engine_test';
    const connection = { query: async (...args) => (await promiseConnection.query(...args))[0] };
    const query = (...args) => connection.query(...args);
    const cases = [];
    const run = async (name, test) => {
        const started = Date.now();
        await test();
        cases.push({ name, durationMs: Date.now() - started });
    };
    // CREATE deliberately fails if this fixture already exists. A test caller
    // must supply a fresh container instead of deleting an arbitrary database.
    await query(`CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    await query(`USE \`${database}\``);
    await query('SET SESSION explicit_defaults_for_timestamp = 1');
    const [{ sqlMode }] = await query('SELECT @@sql_mode AS sqlMode');
    assert.match(sqlMode, /STRICT_(?:TRANS|ALL)_TABLES/, 'destructive conversions must be tested in strict mode');

    await query(`CREATE TABLE edge_values (
        id int NOT NULL AUTO_INCREMENT,
        label varchar(80) NOT NULL DEFAULT 'NULL',
        expression_text varchar(80) NOT NULL DEFAULT '(literal)',
        timestamp_text varchar(80) NOT NULL DEFAULT 'CURRENT_TIMESTAMP',
        changed timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT 'original comment',
        a int NOT NULL DEFAULT 1,
        computed int GENERATED ALWAYS AS (abs(a + 1)) STORED,
        notes text,
        PRIMARY KEY (id),
        KEY label_prefix (label(8)),
        KEY a_id (a,id),
        FULLTEXT KEY text_search (notes)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
    await query('CREATE TABLE parent (id int NOT NULL PRIMARY KEY) ENGINE=InnoDB');
    await query('CREATE TABLE child (id int NOT NULL PRIMARY KEY, parent_id int NOT NULL, KEY parent_idx(parent_id), CONSTRAINT fk_child_parent FOREIGN KEY(parent_id) REFERENCES parent(id) ON DELETE CASCADE) ENGINE=InnoDB');
    await query('CREATE VIEW edge_view AS SELECT id,label FROM edge_values');
    await query("CREATE PROCEDURE edge_procedure() SELECT 'original' AS value");
    await query('CREATE TRIGGER edge_trigger AFTER INSERT ON edge_values FOR EACH ROW SET @engine_trigger_seen = NEW.id');
    await query('INSERT INTO parent VALUES (1)');
    await query('INSERT INTO child VALUES (1,1)');
    await query('INSERT INTO edge_values (notes) VALUES (?)', ["retained quote ' and newline\ntext"]);
    const read = () => getDatabaseStructure(connection, database, 'compare', { output: '.' });
    const expected = await read();
    const differences = async () => findDifferences(expected, await read(), undefined, { serverVersion: version, database });
    const clean = async () => assert.deepEqual(await differences(), [], 'repair must converge to a clean comparison');
    const repair = async () => {
        const diffs = await differences();
        assert.ok(diffs.length, 'intentional drift must be detected');
        const result = await applyDifferences(connection, database, diffs);
        assert.deepEqual(result.failures, [], JSON.stringify(result.failures));
        await clean();
        return diffs;
    };

    await run('quoted NULL, function-looking and expression-looking defaults survive repair', async () => {
        await query("ALTER TABLE edge_values ALTER label SET DEFAULT 'changed', ALTER expression_text SET DEFAULT 'changed', ALTER timestamp_text SET DEFAULT 'changed'");
        await repair();
        const result = await query('INSERT INTO edge_values (notes) VALUES (?)', ['default verification']);
        const [row] = await query('SELECT label,expression_text,timestamp_text FROM edge_values WHERE id=?', [result.insertId]);
        assert.deepEqual(row, { label: 'NULL', expression_text: '(literal)', timestamp_text: 'CURRENT_TIMESTAMP' });
    });
    await run('generated expressions, comments and ON UPDATE are repaired without losing stored data', async () => {
        const before = await query('SELECT id,label,notes FROM edge_values ORDER BY id');
        await query("ALTER TABLE edge_values MODIFY changed timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT 'drift', MODIFY computed int GENERATED ALWAYS AS (abs(a+9)) STORED");
        await repair();
        assert.deepEqual(await query('SELECT id,label,notes FROM edge_values ORDER BY id'), before);
        const [column] = await query("SHOW FULL COLUMNS FROM edge_values WHERE Field='changed'");
        assert.equal(column.Comment, 'original comment');
        assert.match(column.Extra, /on update CURRENT_TIMESTAMP/i);
        await query("UPDATE edge_values SET changed='2000-01-01 00:00:00' WHERE id=1");
        await query('UPDATE edge_values SET a=5 WHERE id=1');
        const [row] = await query('SELECT computed, YEAR(changed) AS updatedYear FROM edge_values WHERE id=1');
        assert.equal(row.computed, 6);
        assert.ok(row.updatedYear > 2000, 'ON UPDATE must work, not merely appear in metadata');
    });
    await run('index prefix, column order and FULLTEXT semantics are restored', async () => {
        await query('ALTER TABLE edge_values DROP INDEX label_prefix, ADD INDEX label_prefix(label(3)), DROP INDEX a_id, ADD INDEX a_id(id,a), DROP INDEX text_search, ADD INDEX text_search(notes(8))');
        await repair();
        const indexes = await query('SHOW INDEX FROM edge_values');
        assert.equal(indexes.find(row => row.Key_name === 'label_prefix').Sub_part, 8);
        assert.deepEqual(indexes.filter(row => row.Key_name === 'a_id').sort((a, b) => a.Seq_in_index - b.Seq_in_index).map(row => row.Column_name), ['a', 'id']);
        assert.equal(indexes.find(row => row.Key_name === 'text_search').Index_type, 'FULLTEXT');
    });
    await run('extra columns and their indexes are removed together without stale DROP failures', async () => {
        await query('ALTER TABLE edge_values ADD COLUMN unexpected int, ADD INDEX unexpected_index(unexpected)');
        await repair();
        assert.equal((await query("SHOW COLUMNS FROM edge_values WHERE Field='unexpected'")).length, 0);
        assert.equal((await query("SHOW INDEX FROM edge_values WHERE Key_name='unexpected_index'")).length, 0);
    });
    await run('foreign-key actions are repaired and enforced', async () => {
        await query('ALTER TABLE child DROP FOREIGN KEY fk_child_parent');
        await query('ALTER TABLE child ADD CONSTRAINT fk_child_parent FOREIGN KEY(parent_id) REFERENCES parent(id) ON DELETE RESTRICT');
        await repair();
        await query('DELETE FROM parent WHERE id=1');
        assert.equal((await query('SELECT * FROM child')).length, 0, 'restored CASCADE must execute');
        await query('INSERT INTO parent VALUES (1)');
        await query('INSERT INTO child VALUES (1,1)');
    });
    await run('invalid existing FK data produces a failure and remains intact', async () => {
        await query('ALTER TABLE child DROP FOREIGN KEY fk_child_parent');
        await query('INSERT INTO child VALUES (2,999)');
        const result = await applyDifferences(connection, database, await differences());
        assert.equal(result.failures.length, 1);
        assert.equal(result.failures[0].type, 'missing_constraint');
        assert.deepEqual(await query('SELECT id,parent_id FROM child ORDER BY id'), [{ id: 1, parent_id: 1 }, { id: 2, parent_id: 999 }]);
        assert.equal((await query('SELECT @@foreign_key_checks AS enabled'))[0].enabled, 1);
        await query('INSERT INTO parent VALUES (999)');
        await repair();
    });
    await run('an invalid view replacement preserves the existing working view', async () => {
        const before = await query('SELECT * FROM edge_view ORDER BY id');
        const result = await applyDifferences(connection, database, [{ type: 'mismatched_view', viewName: 'edge_view', definition: 'CREATE VIEW edge_view AS SELECT * FROM missing_view_source' }]);
        assert.equal(result.failures.length, 1);
        assert.deepEqual(await query('SELECT * FROM edge_view ORDER BY id'), before);
        await clean();
    });
    await run('invalid procedure and trigger replacements recover the working originals', async () => {
        const procedure = await applyDifferences(connection, database, [{ type: 'mismatched_procedure', Name: 'edge_procedure', Definition: 'CREATE PROCEDURE edge_procedure() BEGIN invalid_sql; END' }]);
        assert.equal(procedure.failures.length, 1);
        assert.match(procedure.failures[0].message, /original procedure restored/);
        assert.equal((await query('CALL edge_procedure()'))[0][0].value, 'original');
        const trigger = await applyDifferences(connection, database, [{ type: 'mismatched_trigger', tableName: 'edge_values', trigger: { Name: 'edge_trigger', Definition: 'CREATE TRIGGER edge_trigger AFTER INSERT ON edge_values FOR EACH ROW invalid_sql' } }]);
        assert.equal(trigger.failures.length, 1);
        assert.match(trigger.failures[0].message, /original trigger restored/);
        const inserted = await query('INSERT INTO edge_values(notes) VALUES (?)', ['trigger recovery']);
        assert.equal(Number((await query('SELECT @engine_trigger_seen AS id'))[0].id), inserted.insertId);
        await clean();
    });
    await run('unsafe narrowing fails without truncating existing values', async () => {
        const retained = 'this value must never be truncated';
        await query('UPDATE edge_values SET label=? WHERE id=1', [retained]);
        const desired = structuredClone(expected);
        desired.tables.edge_values.createSQL = desired.tables.edge_values.createSQL.replace('`label` varchar(80)', '`label` varchar(8)');
        const diffs = findDifferences(desired, await read(), undefined, { serverVersion: version, database });
        const result = await applyDifferences(connection, database, diffs);
        assert.ok(result.failures.some(failure => failure.type === 'mismatched_field'));
        assert.match(result.failures.find(failure => failure.type === 'mismatched_field').message, /Data truncated|Data too long/i);
        assert.equal((await query('SELECT label FROM edge_values WHERE id=1'))[0].label, retained);
        await clean();
    });
    await run('repeat apply after convergence is an empty operation', async () => {
        assert.deepEqual(await applyDifferences(connection, database, await differences()), { attempted: 0, failures: [], warnings: [] });
    });

    const expressionSQL = "CREATE TABLE `expression_defaults` (`id` int PRIMARY KEY, `value` varchar(20) DEFAULT (concat('a','b'))) ENGINE=InnoDB";
    await run(version?.startsWith('5.7.') ? '5.7 reports unsupported expression defaults without false success' : '8.0 expression defaults create and repair correctly', async () => {
        const result = await applyDifferences(connection, database, [{ type: 'missing_table', tableName: 'expression_defaults', createSQL: expressionSQL }]);
        if (version?.startsWith('5.7.')) {
            assert.equal(result.failures.length, 1);
            assert.equal((await query("SHOW TABLES LIKE 'expression_defaults'")).length, 0);
        } else {
            assert.deepEqual(result.failures, []);
            await query('INSERT INTO expression_defaults(id) VALUES (1)');
            assert.equal((await query('SELECT value FROM expression_defaults'))[0].value, 'ab');
            const expressionExpected = await read();
            await query("ALTER TABLE expression_defaults ALTER value SET DEFAULT 'changed'");
            const diffs = findDifferences(expressionExpected, await read(), undefined, { serverVersion: version, database });
            assert.ok(diffs.length);
            assert.deepEqual((await applyDifferences(connection, database, diffs)).failures, []);
            assert.deepEqual(findDifferences(expressionExpected, await read(), undefined, { serverVersion: version, database }), []);
        }
    });
    if (version?.startsWith('8.0.')) {
        await run('8.0 descending, functional and invisible indexes survive repair', async () => {
            await query('CREATE TABLE modern_indexes (id int PRIMARY KEY, label varchar(40), KEY descending_label(label DESC), KEY folded_label((lower(label))), KEY hidden_label(label) INVISIBLE) ENGINE=InnoDB');
            const modernExpected = await read();
            await query('ALTER TABLE modern_indexes DROP INDEX descending_label, DROP INDEX folded_label, ALTER INDEX hidden_label VISIBLE');
            const diffs = findDifferences(modernExpected, await read(), undefined, { serverVersion: version, database });
            assert.equal(diffs.filter(diff => diff.tableName === 'modern_indexes').length, 3);
            assert.deepEqual((await applyDifferences(connection, database, diffs)).failures, []);
            assert.deepEqual(findDifferences(modernExpected, await read(), undefined, { serverVersion: version, database }), []);
            const indexes = await query('SHOW INDEX FROM modern_indexes');
            assert.equal(indexes.find(row => row.Key_name === 'descending_label').Collation, 'D');
            assert.ok(indexes.find(row => row.Key_name === 'folded_label').Expression);
            assert.equal(indexes.find(row => row.Key_name === 'hidden_label').Visible, 'NO');
        });
    }
    await run('extra table FK cycles and references from retained tables are removed safely', async () => {
        await query('CREATE TABLE dep_keep(id int PRIMARY KEY) ENGINE=InnoDB');
        await query('INSERT INTO dep_keep VALUES(1)');
        const retainedStructure = await read();
        await query('CREATE TABLE dep_extra_a(id int PRIMARY KEY,other_id int) ENGINE=InnoDB');
        await query('CREATE TABLE dep_extra_z(id int PRIMARY KEY,other_id int) ENGINE=InnoDB');
        await query('INSERT INTO dep_extra_a VALUES(1,1)');
        await query('INSERT INTO dep_extra_z VALUES(1,1)');
        await query('ALTER TABLE dep_extra_a ADD CONSTRAINT dep_fk_a FOREIGN KEY(other_id) REFERENCES dep_extra_z(id)');
        await query('ALTER TABLE dep_extra_z ADD CONSTRAINT dep_fk_z FOREIGN KEY(other_id) REFERENCES dep_extra_a(id)');
        await query('ALTER TABLE dep_keep ADD CONSTRAINT dep_fk_keep FOREIGN KEY(id) REFERENCES dep_extra_a(id)');
        const diffs = findDifferences(retainedStructure, await read(), undefined, { serverVersion: version, database });
        assert.equal(diffs.filter(diff => diff.type === 'extra_constraint').length, 3);
        assert.deepEqual((await applyDifferences(connection, database, diffs)).failures, []);
        assert.deepEqual(findDifferences(retainedStructure, await read(), undefined, { serverVersion: version, database }), []);
        assert.deepEqual(await query('SELECT * FROM dep_keep'), [{ id: 1 }]);
        assert.equal((await query('SELECT @@foreign_key_checks AS enabled'))[0].enabled, 1);
    });
    await run('reverse-ordered view chains converge while unresolved dependencies remain failures', async () => {
        const plannedViews = [
            { type: 'missing_view', viewName: 'dep_view_a', definition: 'CREATE VIEW dep_view_a AS SELECT id FROM dep_view_m' },
            { type: 'missing_view', viewName: 'dep_view_m', definition: 'CREATE VIEW dep_view_m AS SELECT id FROM dep_view_z' },
            { type: 'missing_view', viewName: 'dep_view_z', definition: 'CREATE VIEW dep_view_z AS SELECT id FROM dep_keep' },
        ];
        const result = await applyDifferences(connection, database, plannedViews);
        assert.equal(result.attempted, 3);
        assert.deepEqual(result.failures, []);
        assert.deepEqual(await query('SELECT * FROM dep_view_a'), [{ id: 1 }]);
        const unresolved = await applyDifferences(connection, database, [{ type: 'missing_view', viewName: 'dep_view_invalid', definition: 'CREATE VIEW dep_view_invalid AS SELECT * FROM dep_nonexistent' }]);
        assert.equal(unresolved.failures.length, 1);
    });
    await run('global apply schedules dependent views across schemas before reporting success', async () => {
        const linkedDatabase = 'mysqlsyncr_engine_views';
        // Only remove this second schema after this test successfully creates
        // it. An existing schema is never adopted or erased by the fixture.
        await query(`CREATE DATABASE ${linkedDatabase}`);
        try {
            const result = await applyAllDifferences(connection, {
                [database]: [{ type: 'missing_view', viewName: 'dep_cross', definition: `CREATE VIEW dep_cross AS SELECT id FROM ${linkedDatabase}.dep_source` }],
                [linkedDatabase]: [{ type: 'missing_view', viewName: 'dep_source', definition: `CREATE VIEW dep_source AS SELECT id FROM ${database}.dep_keep` }],
            });
            assert.equal(result.attempted, 2);
            assert.deepEqual(result.failures, []);
            assert.deepEqual(await query(`SELECT * FROM ${database}.dep_cross`), [{ id: 1 }]);
        } finally {
            await query(`DROP VIEW IF EXISTS ${database}.dep_cross`);
            await query(`DROP DATABASE ${linkedDatabase}`);
            await query(`USE ${database}`);
        }
    });
    return cases;
}
