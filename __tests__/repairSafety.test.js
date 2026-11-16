import { findDifferences } from '../src/differences';
import { parseCreateTableSQL, parseConstraint, parseColumnDefinition } from '../src/parsers';
import { applyDifferences, columnDefinition } from '../src/apply';
import { normalizeSQLDefinition } from '../src/normalizers';
import { adaptSQLForServer } from '../src/versions';

const structure = (sql, triggers = []) => {
    const parsed = parseCreateTableSQL(sql);
    return { tables: { [parsed.name]: { ...parsed, createSQL: sql, triggers } }, procedures: [], views: {} };
};
const tableSQL = `CREATE TABLE \`t\` (
  \`id\` int NOT NULL AUTO_INCREMENT,
  \`a\` varchar(50) DEFAULT NULL,
  \`b\` varchar(50) DEFAULT NULL,
  PRIMARY KEY (\`id\`),
  KEY \`ab\` (\`a\`(10),\`b\`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`;
const compareSQL = sql => findDifferences(structure(tableSQL), structure(sql));

describe('repairing changes that used to compare cleanly', () => {
    test.each([
        ['column order', '(`a`(10),`b`)', '(`b`,`a`(10))'],
        ['prefix length', '`a`(10)', '`a`(20)'],
        ['columns with the same index name', '(`a`(10),`b`)', '(`b`)'],
    ])('detects index %s and replaces it in one operation', (_name, before, after) => {
        const diffs = compareSQL(tableSQL.replace(before, after));
        expect(diffs).toHaveLength(1);
        expect(diffs[0]).toMatchObject({ type: 'mismatched_index', indexName: 'ab' });
    });

    test('a differently named nonunique index cannot stand in for a unique index', () => {
        const expected = tableSQL.replace('KEY `ab`', 'UNIQUE KEY `ab`');
        const current = tableSQL.replace('KEY `ab`', 'KEY `other`');
        expect(findDifferences(structure(expected), structure(current)).map(d => d.type)).toContain('missing_index');
    });

    test('detects a removed AUTO_INCREMENT attribute', () => {
        expect(compareSQL(tableSQL.replace(' AUTO_INCREMENT', ''))).toEqual([
            expect.objectContaining({ type: 'mismatched_field', field: expect.objectContaining({ Field: 'id', AutoIncrement: true }) })
        ]);
    });

    test.each([
        ['ON UPDATE', '`a` varchar(50) DEFAULT NULL', '`a` timestamp DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP', '`a` timestamp DEFAULT NULL'],
        ['comment', '`a` varchar(50) DEFAULT NULL', "`a` varchar(50) DEFAULT NULL COMMENT 'original'", "`a` varchar(50) DEFAULT NULL COMMENT 'changed'"],
        ['generated expression', '`a` varchar(50) DEFAULT NULL', '`a` varchar(50) GENERATED ALWAYS AS (concat(`b`,\'x\')) STORED', '`a` varchar(50) GENERATED ALWAYS AS (concat(`b`,\'y\')) STORED'],
    ])('detects changed %s', (_name, before, expectedColumn, currentColumn) => {
        const diffs = findDifferences(structure(tableSQL.replace(before, expectedColumn)), structure(tableSQL.replace(before, currentColumn)));
        expect(diffs).toHaveLength(1);
        expect(diffs[0]).toMatchObject({ type: 'mismatched_field', field: { Field: 'a' } });
    });

    test('combines column mismatches into one change', () => {
        const diffs = compareSQL(tableSQL.replace('`a` varchar(50) DEFAULT NULL', "`a` varchar(10) NOT NULL DEFAULT 'x'"));
        expect(diffs.filter(d => d.field?.Field === 'a')).toHaveLength(1);
    });

    test('restores a missing column to its original position', async () => {
        const diffs = compareSQL(tableSQL.replace('  `a` varchar(50) DEFAULT NULL,\n', ''));
        const statements = [];
        const connection = { query: async sql => { statements.push(sql); return []; } };
        await applyDifferences(connection, 'test', diffs.filter(d => d.type === 'missing_field'));
        expect(statements.find(sql => sql.startsWith('ALTER TABLE'))).toContain('AFTER `id`');
    });

    test('restores AUTO_INCREMENT and its missing key atomically', async () => {
        const live = tableSQL.replace(' AUTO_INCREMENT', '').replace('  PRIMARY KEY (`id`),\n', '');
        const diffs = compareSQL(live);
        const statements = [];
        const connection = { query: async sql => { statements.push(sql); return []; } };
        const result = await applyDifferences(connection, 'test', diffs);
        expect(result.failures).toEqual([]);
        const changes = statements.filter(sql => sql.startsWith('ALTER TABLE'));
        expect(changes).toHaveLength(1);
        expect(changes[0]).toContain('AUTO_INCREMENT FIRST, ADD PRIMARY KEY (`id`)');
    });

    test('detects FULLTEXT versus ordinary index semantics', () => {
        const expected = tableSQL.replace('KEY `ab` (`a`(10),`b`)', 'FULLTEXT KEY `ab` (`a`,`b`)');
        const current = expected.replace('FULLTEXT KEY', 'KEY');
        expect(findDifferences(structure(expected), structure(current))).toEqual([
            expect.objectContaining({ type: 'mismatched_index', index: expect.objectContaining({ Type: 'FULLTEXT' }) })
        ]);
    });

    test('visibility-only index repair uses ALTER INDEX instead of rebuilding', async () => {
        const statements = [];
        const index = { Name: 'hidden', ColumnName: ['a'], Visible: false };
        const connection = { query: async sql => { statements.push(sql); return []; } };
        const result = await applyDifferences(connection, 'test', [{ type: 'mismatched_index', tableName: 't', index, currentIndex: { Name: 'hidden', ColumnName: ['a'] } }]);
        expect(result.failures).toEqual([]);
        expect(statements.filter(sql => sql.startsWith('ALTER TABLE'))).toEqual(['ALTER TABLE `t` ALTER INDEX `hidden` INVISIBLE;']);
    });

    test('preserves descending index columns when recreating an index', async () => {
        const expected = tableSQL.replace('KEY `ab` (`a`(10),`b`)', 'KEY `ab` (`a` DESC,`b`)');
        const current = expected.replace(',\n  KEY `ab` (`a` DESC,`b`)', '');
        const diffs = findDifferences(structure(expected), structure(current));
        expect(diffs).toHaveLength(1);
        const statements = [];
        const connection = { query: async sql => { statements.push(sql); return sql.startsWith('SHOW COLUMNS') ? [{ Field: 'a' }, { Field: 'b' }] : []; } };
        expect((await applyDifferences(connection, 'test', diffs)).failures).toEqual([]);
        expect(statements.find(sql => sql.startsWith('ALTER TABLE'))).toContain('(`a` DESC, `b`)');
    });

    test('dropping an extra column does not try to drop its already removed index', async () => {
        const extraSQL = tableSQL.replace('  `b` varchar(50) DEFAULT NULL,', '  `b` varchar(50) DEFAULT NULL,\n  `extra` int,').replace('KEY `ab` (`a`(10),`b`)', 'KEY `ab` (`a`(10),`b`),\n  KEY `extra_key` (`extra`)');
        const diffs = compareSQL(extraSQL);
        const connection = { query: async sql => {
            if (sql.includes('DROP INDEX `extra_key`')) throw new Error("Can't DROP extra_key; check that column/key exists");
            return [];
        } };
        expect((await applyDifferences(connection, 'test', diffs)).failures).toEqual([]);
    });
});

describe('foreign keys and a complete missing-table plan', () => {
    const fkSQL = `CREATE TABLE \`child\` (
  \`id\` int NOT NULL,
  KEY \`parent_id\` (\`id\`),
  CONSTRAINT \`fk_parent\` FOREIGN KEY (\`id\`) REFERENCES \`Other\`.\`parent\` (\`id\`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=latin1`;

    test('parses real constraint names, cross-database references and composite keys', () => {
        expect(parseConstraint('CONSTRAINT `fk_composite` FOREIGN KEY (`a`,`b`) REFERENCES `Other`.`parent` (`x`,`y`) ON DELETE RESTRICT ON UPDATE CASCADE')).toMatchObject({
            Name: 'fk_composite', ColumnName: ['a', 'b'],
            References: { Database: 'Other', Table: 'parent', Columns: ['x', 'y'] },
            OnDelete: 'RESTRICT', OnUpdate: 'CASCADE'
        });
    });

    test('detects removed and changed foreign keys', () => {
        const withoutFK = fkSQL.replace(/,\n  CONSTRAINT[^\n]+/, '');
        expect(findDifferences(structure(fkSQL), structure(withoutFK))).toEqual([
            expect.objectContaining({ type: 'missing_constraint', constraintName: 'fk_parent' })
        ]);
        expect(findDifferences(structure(fkSQL), structure(fkSQL.replace('ON DELETE CASCADE', 'ON DELETE RESTRICT')))).toEqual([
            expect.objectContaining({ type: 'mismatched_constraint', constraintName: 'fk_parent' })
        ]);
    });

    test('creates empty tables first, then foreign keys and triggers', () => {
        const trigger = { Name: 'trg', Definition: 'CREATE TRIGGER `trg` AFTER INSERT ON `child` FOR EACH ROW SET @x = 1' };
        const diffs = findDifferences(structure(fkSQL, [trigger]), { tables: {}, procedures: [], views: {} });
        expect(diffs.map(d => d.type)).toEqual(['missing_table', 'missing_constraint', 'missing_trigger']);
        expect(diffs[0].createSQL).not.toContain('FOREIGN KEY');
    });

    test('applies a foreign key using its real schema and columns', async () => {
        const statements = [];
        const connection = { query: async sql => { statements.push(sql); return []; } };
        const constraint = parseConstraint('CONSTRAINT `fk_composite` FOREIGN KEY (`a`,`b`) REFERENCES `Other`.`parent` (`x`,`y`) ON DELETE RESTRICT ON UPDATE CASCADE');
        const result = await applyDifferences(connection, 'test', [{ type: 'missing_constraint', tableName: 'child', constraintName: 'fk_composite', constraint }]);
        expect(result.failures).toEqual([]);
        expect(statements.find(sql => sql.startsWith('ALTER TABLE'))).toBe('ALTER TABLE `child` ADD CONSTRAINT `fk_composite` FOREIGN KEY (`a`, `b`) REFERENCES `Other`.`parent` (`x`, `y`) ON DELETE RESTRICT ON UPDATE CASCADE;');
        expect(statements.some(sql => /FOREIGN_KEY_CHECKS/i.test(sql))).toBe(false);
    });

    test('replaces foreign keys without MySQL duplicate-name ALTER failures', async () => {
        const statements = [];
        const constraint = parseConstraint('CONSTRAINT `fk_parent` FOREIGN KEY (`id`) REFERENCES `parent` (`id`) ON DELETE CASCADE');
        const connection = { query: async sql => {
            statements.push(sql);
            if (sql.includes('DROP FOREIGN KEY `fk_parent`') && sql.includes('ADD CONSTRAINT `fk_parent`')) throw new Error('Duplicate foreign key constraint name');
            return [];
        } };
        const result = await applyDifferences(connection, 'test', [{ type: 'mismatched_constraint', tableName: 'child', constraintName: 'fk_parent', constraint }]);
        expect(result.failures).toEqual([]);
        const alterations = statements.filter(sql => sql.startsWith('ALTER TABLE'));
        expect(alterations).toHaveLength(2);
        expect(alterations[0]).toContain('DROP FOREIGN KEY `fk_parent`, ADD CONSTRAINT `mysqlsyncr_fk_');
        expect(alterations[1]).toContain('ADD CONSTRAINT `fk_parent`');
        expect(statements.some(sql => /FOREIGN_KEY_CHECKS/i.test(sql))).toBe(false);
    });
});

describe('SQL text must preserve application data', () => {
    test.each(['NULL', 'CURRENT_TIMESTAMP', '(literal)'])('keeps quoted default %s as a literal', value => {
        const field = parseColumnDefinition("`label` varchar(50) DEFAULT '" + value + "'");
        expect(columnDefinition(field)).toContain("DEFAULT '" + value + "'");
    });

    test('a quoted NULL default differs from a SQL NULL default', () => {
        const expected = tableSQL.replace('`a` varchar(50) DEFAULT NULL', "`a` varchar(50) DEFAULT 'NULL'");
        expect(findDifferences(structure(expected), structure(tableSQL))).toEqual([
            expect.objectContaining({ type: 'mismatched_field', info: 'Default' })
        ]);
    });

    test('preserves escaped control characters when rebuilding a column', () => {
        const field = parseColumnDefinition("`label` varchar(50) DEFAULT 'first\\nsecond\\tline'");
        expect(field.Default).toBe('first\nsecond\tline');
        expect(columnDefinition(field)).toContain("DEFAULT 'first\nsecond\tline'");
    });

    test('keeps deeply nested generated expressions', () => {
        const field = parseColumnDefinition("`label` varchar(50) GENERATED ALWAYS AS (concat(lower(trim(coalesce(`a`, 'x'))), 'tail')) STORED");
        expect(field.Generated).toBe("(concat(lower(trim(coalesce(`a`, 'x'))), 'tail')) STORED");
    });
    test('preserves literal whitespace and type-looking content when comparing routines', () => {
        expect(normalizeSQLDefinition("SELECT 'a  b'")).not.toBe(normalizeSQLDefinition("SELECT 'a b'"));
        expect(normalizeSQLDefinition("SELECT 'int(11) utf8mb3'")).not.toBe(normalizeSQLDefinition("SELECT 'int utf8'"));
        expect(normalizeSQLDefinition('SELECT   1\n FROM `table`')).toBe(normalizeSQLDefinition('SELECT 1 FROM `table`'));
    });

    test('adapts collation syntax without modifying literals or identifiers', () => {
        expect(adaptSQLForServer("SELECT 'utf8mb4_0900_ai_ci', `utf8mb4_0900_ai_ci` COLLATE utf8mb4_0900_ai_ci", '5.7.44'))
            .toBe("SELECT 'utf8mb4_0900_ai_ci', `utf8mb4_0900_ai_ci` COLLATE utf8mb4_unicode_ci");
    });

    test('unknown-version collation fallback preserves literal column comments', async () => {
        const statements = [];
        const connection = { query: async sql => {
            if (sql.startsWith('SELECT VERSION')) throw new Error('version unavailable');
            if (sql.startsWith('CREATE')) {
                statements.push(sql);
                if (sql.endsWith('COLLATE=utf8mb4_0900_ai_ci')) throw new Error("Unknown collation: 'utf8mb4_0900_ai_ci'");
            }
            return [];
        } };
        const result = await applyDifferences(connection, 'test', [{ type: 'missing_table', tableName: 't', createSQL: "CREATE TABLE `t` (`a` int COMMENT 'COLLATE=utf8mb4_0900_ai_ci') ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci" }]);
        expect(result.failures).toEqual([]);
        expect(statements[1]).toContain("COMMENT 'COLLATE=utf8mb4_0900_ai_ci'");
        expect(statements[1]).toMatch(/COLLATE=utf8mb4_unicode_ci$/);
    });

    test('failed replacement of a view never drops the existing view', async () => {
        const statements = [];
        const connection = { query: async sql => { statements.push(sql); if (sql.startsWith('CREATE')) throw new Error('bad view'); return []; } };
        const result = await applyDifferences(connection, 'test', [{ type: 'mismatched_view', viewName: 'v', definition: 'CREATE ALGORITHM=UNDEFINED VIEW `v` AS SELECT missing FROM `t`' }]);
        expect(result.failures).toHaveLength(1);
        expect(statements.some(sql => sql.startsWith('DROP VIEW'))).toBe(false);
        expect(statements.find(sql => sql.startsWith('CREATE'))).toMatch(/^CREATE OR REPLACE ALGORITHM=/);
    });

    test.each([
        ['procedure', { type: 'mismatched_procedure', Name: 'p', Definition: 'CREATE PROCEDURE `p`() BEGIN invalid_sql; END' }, 'CREATE PROCEDURE `p`() SELECT 1', 'Create Procedure'],
        ['trigger', { type: 'mismatched_trigger', tableName: 't', trigger: { Name: 'trg', Definition: 'CREATE TRIGGER `trg` AFTER INSERT ON `t` FOR EACH ROW invalid_sql' } }, 'CREATE TRIGGER `trg` AFTER INSERT ON `t` FOR EACH ROW SET @x = 1', 'SQL Original Statement'],
    ])('failed %s replacement restores the original object', async (_kind, diff, previous, key) => {
        const statements = [];
        const connection = { query: async sql => {
            statements.push(sql);
            if (sql.startsWith('SHOW CREATE')) return [{ [key]: previous }];
            if (sql.includes('invalid_sql')) throw new Error('invalid replacement');
            return [];
        } };
        const result = await applyDifferences(connection, 'test', [diff]);
        expect(result.failures).toHaveLength(1);
        expect(statements.at(-1)).toBe(previous);
    });

    test('a supposedly missing procedure is never dropped before creation', async () => {
        const statements = [];
        const connection = { query: async sql => { statements.push(sql); return []; } };
        await applyDifferences(connection, 'test', [{ type: 'missing_procedure', Name: 'p', Definition: 'CREATE PROCEDURE `p`() SELECT 1' }]);
        expect(statements.some(sql => sql.startsWith('DROP PROCEDURE'))).toBe(false);
    });
});
