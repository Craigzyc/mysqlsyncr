import { findDifferences } from '../src/differences';
import { parseCreateTableSQL } from '../src/parsers';
import { applyDifferences, applyViewsAcrossDatabases } from '../src/apply';

const table = sql => ({ ...parseCreateTableSQL(sql), createSQL: sql, triggers: [] });

test('extra table foreign keys are scheduled for removal before dropping either table', () => {
    const current = { tables: {
        extra_a: table('CREATE TABLE `extra_a` (`id` int PRIMARY KEY, `other` int, CONSTRAINT `fk_a` FOREIGN KEY (`other`) REFERENCES `extra_z` (`id`))'),
        extra_z: table('CREATE TABLE `extra_z` (`id` int PRIMARY KEY, `other` int, CONSTRAINT `fk_z` FOREIGN KEY (`other`) REFERENCES `extra_a` (`id`))'
        )
    }, procedures: [], views: {} };
    const differences = findDifferences({ tables: {}, procedures: [], views: {} }, current);
    expect(differences.filter(diff => diff.type === 'extra_constraint').map(diff => diff.constraintName).sort()).toEqual(['fk_a', 'fk_z']);
    expect(differences.filter(diff => diff.type === 'extra_table')).toHaveLength(2);
});

test('view creation retries missing dependencies only after another view succeeds', async () => {
    const created = new Set();
    const attempts = [];
    const connection = { query: async sql => {
        if (sql.startsWith('CREATE')) {
            const name = sql.includes('VIEW `view_a`') ? 'view_a' : 'view_z';
            attempts.push(name);
            if (name === 'view_a' && !created.has('view_z')) throw Object.assign(new Error("Table view_z doesn't exist"), { code: 'ER_NO_SUCH_TABLE', errno: 1146 });
            created.add(name);
        }
        return [];
    } };
    const result = await applyDifferences(connection, 'fixture', [
        { type: 'missing_view', viewName: 'view_a', definition: 'CREATE VIEW `view_a` AS SELECT * FROM `view_z`' },
        { type: 'missing_view', viewName: 'view_z', definition: 'CREATE VIEW `view_z` AS SELECT 1 AS value' },
    ]);
    expect(result.failures).toEqual([]);
    expect(result.attempted).toBe(2);
    expect(attempts).toEqual(['view_a', 'view_z', 'view_a']);
});

test('unresolved view dependencies remain failures and do not retry forever', async () => {
    let attempts = 0;
    const connection = { query: async sql => {
        if (sql.startsWith('CREATE')) { attempts++; throw Object.assign(new Error('missing dependency'), { code: 'ER_NO_SUCH_TABLE' }); }
        return [];
    } };
    const result = await applyDifferences(connection, 'fixture', [{ type: 'missing_view', viewName: 'broken', definition: 'CREATE VIEW `broken` AS SELECT * FROM absent' }]);
    expect(result.failures).toHaveLength(1);
    expect(attempts).toBe(1);
});

test('view syntax errors are never retried as dependency failures', async () => {
    let attempts = 0;
    const connection = { query: async sql => {
        if (sql.startsWith('CREATE')) { attempts++; throw Object.assign(new Error('invalid view syntax'), { code: 'ER_PARSE_ERROR' }); }
        return [];
    } };
    const result = await applyDifferences(connection, 'fixture', [{ type: 'missing_view', viewName: 'broken', definition: 'CREATE VIEW broken AS INVALID' }]);
    expect(result.failures).toHaveLength(1);
    expect(attempts).toBe(1);
});

test('view dependencies are retried across schema batches with their own USE scope', async () => {
    let selected;
    let ready = false;
    const connection = { query: async sql => {
        if (sql.startsWith('USE')) selected = sql;
        if (sql.includes('VIEW `view_a`')) {
            expect(selected).toBe('USE `database_a`');
            if (!ready) throw Object.assign(new Error('dependency missing'), { code: 'ER_NO_SUCH_TABLE' });
        }
        if (sql.includes('VIEW `view_z`')) { expect(selected).toBe('USE `database_z`'); ready = true; }
        return [];
    } };
    const result = await applyViewsAcrossDatabases(connection, {
        database_a: [{ type: 'missing_view', viewName: 'view_a', definition: 'CREATE VIEW `view_a` AS SELECT * FROM database_z.view_z' }],
        database_z: [{ type: 'missing_view', viewName: 'view_z', definition: 'CREATE VIEW `view_z` AS SELECT 1 AS value' }],
    });
    expect(result.failures).toEqual([]);
    expect(result.attempted).toBe(2);
});
