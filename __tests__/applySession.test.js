import { findDifferences } from '../src/differences';
import { parseCreateTableSQL } from '../src/parsers';
import { applyDifferences } from '../src/apply';

const structure = (...sqls) => ({
    tables: Object.fromEntries(sqls.map(sql => {
        const parsed = parseCreateTableSQL(sql);
        return [parsed.name, { ...parsed, createSQL: sql, triggers: [] }];
    })),
    procedures: [],
    views: {},
});

// Records every statement. `session` is what the version/session read returns;
// `fail(sql)` returns an error to throw for a statement, or nothing.
const recorder = ({ session = { version: '5.7.44', explicit_defaults_for_timestamp: 0 }, fail = () => null } = {}) => {
    const statements = [];
    const connection = {
        statements,
        query: async sql => {
            statements.push(sql);
            const error = fail(sql);
            if (error) throw error;
            if (sql.startsWith('SELECT VERSION() AS version, @@SESSION')) {
                if (session instanceof Error) throw session;
                return [session];
            }
            if (sql.startsWith('SELECT VERSION')) return [{ version: session?.version ?? null }];
            return [];
        },
    };
    return connection;
};
const ddl = statements => statements.filter(sql => /^(ALTER|CREATE|DROP)/.test(sql));
const sessionSets = statements => statements.filter(sql => sql.startsWith('SET SESSION explicit_defaults_for_timestamp'));

const tableSQL = 'CREATE TABLE `t` (\n  `id` int NOT NULL,\n  `a` int DEFAULT NULL,\n  PRIMARY KEY (`id`)\n) ENGINE=InnoDB DEFAULT CHARSET=latin1';
const missingTable = findDifferences(structure(tableSQL), structure());

describe('explicit_defaults_for_timestamp is restored on the caller\'s connection', () => {
    test('after a successful repair the prior session value is put back last', async () => {
        const connection = recorder();
        const result = await applyDifferences(connection, 'db', [...missingTable]);
        expect(result.failures).toEqual([]);
        const { statements } = connection;
        expect(sessionSets(statements)).toEqual(['SET SESSION explicit_defaults_for_timestamp = 1', 'SET SESSION explicit_defaults_for_timestamp = 0']);
        // Set before any DDL, restored after all of it
        expect(statements.indexOf('SET SESSION explicit_defaults_for_timestamp = 1')).toBeLessThan(statements.findIndex(sql => sql.startsWith('CREATE TABLE')));
        expect(statements.at(-1)).toBe('SET SESSION explicit_defaults_for_timestamp = 0');
    });

    test('after a failed difference the prior value is still restored', async () => {
        const connection = recorder({ fail: sql => sql.startsWith('CREATE TABLE') ? Object.assign(new Error('denied'), { errno: 1142 }) : null });
        const result = await applyDifferences(connection, 'db', [...missingTable]);
        expect(result.failures).toHaveLength(1);
        expect(connection.statements.at(-1)).toBe('SET SESSION explicit_defaults_for_timestamp = 0');
    });

    test('when the repair itself throws, the session is restored and the error still surfaces', async () => {
        const connection = recorder();
        await expect(applyDifferences(connection, 'db', null)).rejects.toThrow(TypeError);
        expect(sessionSets(connection.statements)).toEqual(['SET SESSION explicit_defaults_for_timestamp = 1', 'SET SESSION explicit_defaults_for_timestamp = 0']);
    });

    test('a session that already has it on is not touched at all', async () => {
        const connection = recorder({ session: { version: '8.0.40', explicit_defaults_for_timestamp: 1 } });
        await applyDifferences(connection, 'db', [...missingTable]);
        expect(sessionSets(connection.statements)).toEqual([]);
    });

    test('when the prior value cannot be read the session is left alone and the version still resolves', async () => {
        const connection = recorder({ session: new Error('denied') });
        const v80 = 'CREATE TABLE `t` (\n  `id` int NOT NULL,\n  `a` varchar(5) COLLATE utf8mb4_0900_ai_ci DEFAULT NULL,\n  PRIMARY KEY (`id`)\n) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci';
        connection.query = (original => async sql => sql.startsWith('SELECT VERSION() AS version') && !sql.includes('@@')
            ? (connection.statements.push(sql), [{ version: '5.7.44' }]) : original(sql))(connection.query);
        const result = await applyDifferences(connection, 'db', findDifferences(structure(v80), structure()));
        expect(sessionSets(connection.statements)).toEqual([]);
        // The 5.7 adaptation still happened, so the fallback version read was used
        expect(ddl(connection.statements)[0]).not.toContain('0900');
        expect(result.failures).toEqual([]);
    });

    test('a failed restore is reported without replacing the repair result', async () => {
        const connection = recorder({ fail: sql => sql === 'SET SESSION explicit_defaults_for_timestamp = 0' ? new Error('gone away') : null });
        const errors = jest.spyOn(console, 'error').mockImplementation(() => {});
        try {
            const result = await applyDifferences(connection, 'db', [...missingTable]);
            expect(result.failures).toEqual([]);
            expect(errors.mock.calls.flat().join(' ')).toMatch(/Could not restore explicit_defaults_for_timestamp/);
        } finally {
            errors.mockRestore();
        }
    });
});

describe('charset drift on the columns of a multi-column FULLTEXT index', () => {
    const template = 'CREATE TABLE `ft` (\n  `id` int NOT NULL,\n  `a` text,\n  `b` varchar(100) DEFAULT NULL,\n  PRIMARY KEY (`id`),\n  FULLTEXT KEY `ft_ab` (`a`,`b`)\n) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci';
    const drifted = template.replace(/utf8mb4_unicode_ci/g, 'utf8mb4_bin');
    const other = 'CREATE TABLE `zz` (\n  `id` int NOT NULL,\n  `c` varchar(10) DEFAULT NULL,\n  PRIMARY KEY (`id`)\n) ENGINE=InnoDB DEFAULT CHARSET=latin1';
    const ftError = column => Object.assign(new Error(`Column '${column}' cannot be part of FULLTEXT index`), { code: 'ER_BAD_FT_COLUMN', errno: 1283 });
    // A FULLTEXT column change made on its own always leaves the index mixed
    const fulltextServer = sql => /^ALTER TABLE `ft` CHANGE/.test(sql) && (sql.match(/CHANGE /g) || []).length === 1 ? ftError(sql.includes('CHANGE `a`') ? 'b' : 'a') : null;

    const differences = () => findDifferences(structure(template, other), structure(drifted, other.replace("varchar(10)", "varchar(20)")));

    test('the table collation is set after its charset, which would otherwise reset it', async () => {
        const diffs = differences().filter(d => d.type === 'mismatched_table_options');
        expect(Object.keys(diffs[0].options)).toEqual(['collate', 'charset']);
        const connection = recorder();
        await applyDifferences(connection, 'db', diffs);
        expect(ddl(connection.statements)).toEqual(['ALTER TABLE `ft` DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_unicode_ci;']);
    });

    test('the drift is found as one mismatched_field per column', () => {
        expect(differences().filter(d => d.type === 'mismatched_field').map(d => `${d.tableName}.${d.field.Field}`)).toEqual(['ft.a', 'ft.b', 'zz.c']);
    });

    test('the table\'s column changes are retried together in one ALTER, in column order', async () => {
        const connection = recorder({ fail: fulltextServer });
        const result = await applyDifferences(connection, 'db', differences());
        expect(result.failures).toEqual([]);
        const alters = ddl(connection.statements).filter(sql => sql.includes('CHANGE'));
        expect(alters).toHaveLength(3);
        expect(alters[0]).toMatch(/^ALTER TABLE `ft` CHANGE `a` `a` text .*COLLATE utf8mb4_unicode_ci.* AFTER `id`;$/);
        expect(alters[1]).toMatch(/^ALTER TABLE `ft` CHANGE `a` `a` text .*AFTER `id`, CHANGE `b` `b` varchar\(100\) .*COLLATE utf8mb4_unicode_ci.* AFTER `a`;$/);
        // b went with a; the other table is still repaired on its own
        expect(alters[2]).toMatch(/^ALTER TABLE `zz` CHANGE `c` `c` varchar\(10\)/);
    });

    test('a column added between the changed ones is added in the same ALTER, in place', async () => {
        const withNew = template.replace('`b` varchar(100)', '`n` int DEFAULT NULL,\n  `b` varchar(100)');
        const connection = recorder({ fail: fulltextServer });
        const result = await applyDifferences(connection, 'db', findDifferences(structure(withNew), structure(drifted)));
        expect(result.failures).toEqual([]);
        const combined = ddl(connection.statements).find(sql => (sql.match(/CHANGE /g) || []).length > 1);
        expect(combined).toMatch(/CHANGE `a` .* AFTER `id`, ADD COLUMN `n` int .* AFTER `a`, CHANGE `b` .* AFTER `n`;$/);
        expect(ddl(connection.statements).filter(sql => sql.includes('ADD COLUMN `n`'))).toHaveLength(1);
    });

    test('when the combined ALTER fails too, both errors are reported and the rest is still tried on its own', async () => {
        const connection = recorder({ fail: sql => fulltextServer(sql) || ((sql.match(/CHANGE /g) || []).length > 1 ? new Error('Lock wait timeout exceeded') : null) });
        const result = await applyDifferences(connection, 'db', differences());
        expect(result.failures.map(f => f.description)).toEqual(['mismatched_field ft.a', 'mismatched_field ft.b']);
        expect(result.failures[0].message).toBe("Column 'b' cannot be part of FULLTEXT index; retrying together with mismatched_field ft.b in one ALTER also failed: Lock wait timeout exceeded");
        expect(result.failures[1].message).toBe("Column 'a' cannot be part of FULLTEXT index");
        expect(ddl(connection.statements).filter(sql => /^ALTER TABLE `ft` CHANGE `b`/.test(sql))).toHaveLength(1);
    });

    test('any other error is not retried', async () => {
        const connection = recorder({ fail: sql => /^ALTER TABLE `ft` CHANGE `a`/.test(sql) ? Object.assign(new Error('Data truncated'), { errno: 1265 }) : null });
        const result = await applyDifferences(connection, 'db', differences());
        expect(result.failures.map(f => f.description)).toEqual(['mismatched_field ft.a']);
        expect(ddl(connection.statements).filter(sql => (sql.match(/CHANGE /g) || []).length > 1)).toEqual([]);
    });
});
