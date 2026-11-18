import { findDifferences } from '../src/differences';
import { parseCreateTableSQL } from '../src/parsers';
import { normalizeSQLDefinition, normalizeServerExpression, normalizeTriggerDefinition } from '../src/normalizers';
import { formatDifference } from '../src/loggers';
import { adaptSQLForServer } from '../src/versions';
import { replaceCreateSQLElement, orderColumnMoves } from '../src/acceptCurrent';

const shape = (sql, triggers = []) => ({ tables: { t: { ...parseCreateTableSQL(sql), createSQL: sql, triggers } }, procedures: [], views: {} });
const table = columns => `CREATE TABLE \`t\` (\n${columns.map(c => `  ${c}`).join(',\n')}\n) ENGINE=InnoDB DEFAULT CHARSET=latin1`;

describe('MySQL 8.0 charset introducers', () => {
    // Verified on 5.7.44 and 8.0.46: the same DDL stores different text.
    const v57 = table(['`qty` int(11) DEFAULT NULL', "`g` varchar(64) GENERATED ALWAYS AS (concat('p-',`qty`)) STORED"]);
    const v80 = table(['`qty` int DEFAULT NULL', "`g` varchar(64) GENERATED ALWAYS AS (concat(_utf8mb4'p-',`qty`)) STORED"]);
    test('a generated column compares equal across versions', () => {
        expect(findDifferences(shape(v57), shape(v80))).toEqual([]);
        expect(findDifferences(shape(v80), shape(v57))).toEqual([]);
    });
    test('a changed generated expression is still reported', () => {
        const changed = v80.replace("'p-'", "'q-'");
        expect(findDifferences(shape(v57), shape(changed)).map(d => d.changes)).toEqual([['Generated']]);
    });
    test('_binary changes the result and is kept', () => {
        expect(normalizeServerExpression("concat(_binary'a',x)")).not.toBe(normalizeServerExpression("concat('a',x)"));
    });
    test('only charset names are introducers; identifiers and string contents are untouched', () => {
        expect(normalizeServerExpression("SELECT _total 'alias'")).toBe("SELECT _total 'alias'");
        expect(normalizeServerExpression("SELECT `_utf8mb4` 'alias'")).toBe("SELECT `_utf8mb4` 'alias'");
        expect(normalizeServerExpression("SELECT '_utf8mb4''x'")).toBe("SELECT '_utf8mb4''x'");
        expect(normalizeServerExpression("SELECT _latin1 'x', _utf8'y', N'z'")).toBe("SELECT 'x', 'y', N'z'");
    });
    test('expression defaults compare without introducers', () => {
        const a = table(["`j` varchar(10) DEFAULT (concat('a','b'))"]);
        const b = table(["`j` varchar(10) DEFAULT (concat(_utf8mb4'a',_utf8mb4'b'))"]);
        expect(findDifferences(shape(a), shape(b))).toEqual([]);
        expect(findDifferences(shape(a), shape(b.replace("'b'", "'c'"))).map(d => d.changes)).toEqual([['Default']]);
    });
});

describe('trigger definitions across versions', () => {
    const v57 = "CREATE DEFINER=`root`@`%` TRIGGER child_bi BEFORE INSERT ON child FOR EACH ROW SET NEW.ref_code = IFNULL(NEW.ref_code, 'x')";
    const v80 = "CREATE DEFINER=`root`@`%` TRIGGER `child_bi` BEFORE INSERT ON `child` FOR EACH ROW SET NEW.ref_code = IFNULL(NEW.ref_code, 'x')";
    test('quoting of the trigger and table names is ignored', () => {
        expect(normalizeTriggerDefinition(v57)).toBe(normalizeTriggerDefinition(v80));
        const sql = table(['`id` int DEFAULT NULL']);
        expect(findDifferences(shape(sql, [{ Name: 'child_bi', Definition: v57 }]), shape(sql, [{ Name: 'child_bi', Definition: v80 }]))).toEqual([]);
    });
    test.each([
        ['timing', v80.replace('BEFORE', 'AFTER')],
        ['event', v80.replace('INSERT', 'UPDATE')],
        ['table', v80.replace('`child` FOR', '`other` FOR')],
        ['body', v80.replace("'x'", "'y'")],
        ['definer', v80.replace('`root`@`%`', '`app`@`%`')],
        ['order', v80.replace('FOR EACH ROW ', 'FOR EACH ROW FOLLOWS `other` ')],
    ])('a different %s is reported', (_, changed) => {
        expect(normalizeTriggerDefinition(changed)).not.toBe(normalizeTriggerDefinition(v57));
    });
    test('schema-qualified and lowercase headers are canonical', () => {
        expect(normalizeTriggerDefinition("create definer=root@`%` trigger `db`.`child_bi` before insert on `db`.child for each row SET NEW.ref_code = IFNULL(NEW.ref_code, 'x')"))
            .toBe(normalizeTriggerDefinition(v57));
    });
    test('an unparseable definition falls back to SQL normalization', () => {
        expect(normalizeTriggerDefinition('CREATE  TRIGGER')).toBe('CREATE TRIGGER');
    });
});

describe('column order', () => {
    const columns = names => table(names.map(name => `\`${name}\` int DEFAULT NULL`));
    test('one moved column reports only that column, with readable positions', () => {
        // Live has `e` moved to the front: the old comparison flagged every column.
        const diffs = findDifferences(shape(columns(['a', 'b', 'c', 'd', 'e'])), shape(columns(['e', 'a', 'b', 'c', 'd'])));
        expect(diffs.map(d => d.field.Field)).toEqual(['e']);
        expect(diffs[0].comparison.Position).toEqual({ expected: 'AFTER d', current: 'FIRST' });
        expect(formatDifference(diffs[0]).Details).toBe('Field e Position is "FIRST", expected "AFTER d"');
    });
    test('missing and extra columns do not cause position reports', () => {
        expect(findDifferences(shape(columns(['a', 'b', 'c'])), shape(columns(['a', 'x', 'c']))).map(d => d.type)).toEqual(['extra_field', 'missing_field']);
    });

    // Simulate the repair (MODIFY ... AFTER <template predecessor>, in template
    // order) and accept-current (move to the live position) on random orders.
    const shuffle = (list, random) => {
        const copy = [...list];
        for (let i = copy.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [copy[i], copy[j]] = [copy[j], copy[i]]; }
        return copy;
    };
    let seed = 12345;
    const random = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    test('repairing only the reported columns always restores the template order', () => {
        for (let run = 0; run < 400; run++) {
            const template = Array.from({ length: 2 + Math.floor(random() * 9) }, (_, i) => `c${i}`);
            const live = shuffle(template, random);
            let order = [...live];
            for (const diff of findDifferences(shape(columns(template)), shape(columns(live)))) {
                order.splice(order.indexOf(diff.field.Field), 1);
                order.splice(diff.after === null ? 0 : order.indexOf(diff.after) + 1, 0, diff.field.Field);
            }
            expect(order).toEqual(template);
        }
    });
    test('accepting only the reported columns always produces the live order', () => {
        for (let run = 0; run < 200; run++) {
            const template = Array.from({ length: 2 + Math.floor(random() * 8) }, (_, i) => `c${i}`);
            const live = shuffle(template, random);
            let sql = columns(template);
            for (const diff of orderColumnMoves(findDifferences(shape(sql), shape(columns(live))), shape(columns(live)))) {
                sql = replaceCreateSQLElement(sql, columns(live), `col:${diff.field.Field}`, { move: true });
            }
            expect(parseCreateTableSQL(sql).columns.map(c => c.Field)).toEqual(live);
        }
    });
});

describe('difference reports show the compared values', () => {
    const latin = 'CREATE TABLE `t` (\n  `email` varchar(255) NOT NULL\n) ENGINE=InnoDB DEFAULT CHARSET=latin1';
    const mb4 = 'CREATE TABLE `t` (\n  `email` varchar(255) NOT NULL\n) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci';
    const defaults = { defaultCollations: { latin1: 'latin1_swedish_ci', utf8mb4: 'utf8mb4_0900_ai_ci' } };
    test('an inherited charset is reported as the effective charset, not null', () => {
        const [options, field] = findDifferences(shape(mb4), shape(latin), undefined, defaults);
        expect(formatDifference(options)).toEqual({
            Type: 'mismatched_table_options', Name: 't', Action: 'Table options are mismatched',
            Details: 'Table t options: charset is "latin1", expected "utf8mb4"; collate is none, expected "utf8mb4_0900_ai_ci"',
        });
        expect(formatDifference(field).Details).toBe('Field email Charset is "latin1", expected "utf8mb4"; Collate is "latin1_swedish_ci", expected "utf8mb4_0900_ai_ci"');
    });
    test('nullability, type, comment and ON UPDATE are all listed', () => {
        const expected = table(["`u` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT 'when'", '`f` float DEFAULT NULL']);
        const current = table(['`u` timestamp NULL DEFAULT CURRENT_TIMESTAMP', '`f` float(10,2) DEFAULT NULL']);
        expect(findDifferences(shape(expected), shape(current)).map(d => formatDifference(d).Details)).toEqual([
            'Field u Null is "NULL", expected "NOT NULL"; OnUpdate is none, expected "CURRENT_TIMESTAMP"; Comment is none, expected "when"',
            'Field f Type is "float(10,2)", expected "float"',
        ]);
    });
    test('differences saved before comparison values existed still format', () => {
        expect(formatDifference({ type: 'mismatched_field', tableName: 't', info: 'Null', field: { Field: 'x', NotNull: true }, currentField: { Field: 'x' } }).Details)
            .toBe('Field x Null is none, expected true');
    });
    test('every difference type has a name and description', () => {
        const types = ['missing_database', 'missing_constraint', 'extra_constraint', 'mismatched_constraint', 'mismatched_view', 'extra_view', 'mismatched_index'];
        for (const type of types) {
            const row = formatDifference({ type, database: 'db', tableName: 't', viewName: 'v', constraintName: 'fk', index: { Name: 'i', ColumnName: ['a'] }, currentIndex: { ColumnName: ['b'] } });
            expect(row.Details).not.toMatch(/Unhandled/);
            expect(row.Name).toBeTruthy();
        }
    });
});

describe('descending indexes on 5.7', () => {
    // 5.7.44 accepts KEY (name DESC) and stores it ascending.
    const v80 = 'CREATE TABLE `t` (\n  `name` varchar(20) DEFAULT NULL,\n  KEY `d` (`name` DESC),\n  KEY `e` ((lower(`name`)))\n) ENGINE=InnoDB DEFAULT CHARSET=latin1';
    const v57 = 'CREATE TABLE `t` (\n  `name` varchar(20) DEFAULT NULL,\n  KEY `d` (`name`),\n  KEY `e` ((lower(`name`)))\n) ENGINE=InnoDB DEFAULT CHARSET=latin1';
    test('compare as ascending on 5.7, so a restore converges', () => {
        expect(findDifferences(shape(v80), shape(v57), undefined, { serverVersion: '5.7.44' })).toEqual([]);
    });
    test('stay descending on 8.0', () => {
        expect(findDifferences(shape(v80), shape(v57), undefined, { serverVersion: '8.0.46' }).map(d => d.type)).toEqual(['mismatched_index']);
    });
});

describe('adversarial review regressions', () => {
    test('procedure and trigger bodies keep introducers: they are stored as written', () => {
        expect(normalizeSQLDefinition("BEGIN SELECT * FROM t WHERE c = _latin1'x'; END")).not.toBe(normalizeSQLDefinition("BEGIN SELECT * FROM t WHERE c = _utf8mb4'x'; END"));
        const trigger = body => `CREATE DEFINER=\`root\`@\`%\` TRIGGER t BEFORE INSERT ON x FOR EACH ROW SET NEW.a = ${body}`;
        expect(normalizeTriggerDefinition(trigger("_latin1'x'"))).not.toBe(normalizeTriggerDefinition(trigger("'x'")));
    });
    test('definer user names are case-sensitive, quoting is not', () => {
        const trigger = definer => `CREATE DEFINER=${definer} TRIGGER \`t\` BEFORE INSERT ON \`x\` FOR EACH ROW SET @a = 1`;
        expect(normalizeTriggerDefinition(trigger('`Admin`@`%`'))).not.toBe(normalizeTriggerDefinition(trigger('`admin`@`%`')));
        expect(normalizeTriggerDefinition(trigger("'app'@'10.0.%'"))).toBe(normalizeTriggerDefinition(trigger('`app`@`10.0.%`')));
        expect(normalizeTriggerDefinition(trigger('`app user`@`%`'))).toBe(normalizeTriggerDefinition('CREATE DEFINER=`app user`@`%` TRIGGER t BEFORE INSERT ON x FOR EACH ROW SET @a = 1'));
        expect(normalizeTriggerDefinition(trigger('CURRENT_USER'))).toMatch(/^\["CURRENT_USER"/);
    });
    test('non-ASCII unquoted trigger identifiers parse', () => {
        expect(normalizeTriggerDefinition('CREATE TRIGGER café BEFORE INSERT ON tablé FOR EACH ROW SET @a = 1'))
            .toBe(normalizeTriggerDefinition('CREATE TRIGGER `café` BEFORE INSERT ON `tablé` FOR EACH ROW SET @a = 1'));
    });
    test('accepting an extra column next to a moved one converges in one run', () => {
        const columns = names => table(names.map(name => `\`${name}\` int DEFAULT NULL`));
        const live = ['B', 'A', 'X'];
        let sql = columns(['A', 'B']);
        for (const diff of orderColumnMoves(findDifferences(shape(sql), shape(columns(live))), shape(columns(live)))) {
            sql = replaceCreateSQLElement(sql, columns(live), `col:${diff.field.Field}`, { move: diff.type === 'mismatched_field' });
        }
        expect(parseCreateTableSQL(sql).columns.map(c => c.Field)).toEqual(live);
    });
    test('index reports name the property that differs', () => {
        const index = (Name, extra = {}) => ({ Name, ColumnName: ['a'], ...extra });
        expect(formatDifference({ type: 'mismatched_index', tableName: 't', index: index('i', { Unique: true }), currentIndex: index('i') }).Details).toBe('Index i unique is false, expected true');
        expect(formatDifference({ type: 'mismatched_index', tableName: 't', index: index('i', { Visible: false }), currentIndex: index('i') }).Details).toBe('Index i visible is true, expected false');
        expect(formatDifference({ type: 'mismatched_index', tableName: 't', index: index('i') }).Details).toBe('Index i is mismatched, expected (a)');
    });
});

describe('implicit utf8mb4 collation of a 5.7 template', () => {
    // 5.7.44 omits utf8mb4_general_ci (its default); 8.0.46 prints it.
    const v57 = 'CREATE TABLE `t` (\n  `v` varchar(10) DEFAULT NULL,\n  `c` varchar(10) CHARACTER SET utf8mb4 DEFAULT NULL\n) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4';
    const v80 = 'CREATE TABLE `t` (\n  `v` varchar(10) COLLATE utf8mb4_general_ci DEFAULT NULL,\n  `c` varchar(10) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci DEFAULT NULL\n) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci';
    const server80 = { serverVersion: '8.0.46', defaultCollations: { utf8mb4: 'utf8mb4_0900_ai_ci', latin1: 'latin1_swedish_ci' } };
    test('means general_ci on an 8.0 server', () => {
        expect(findDifferences(shape(v57), shape(v80), undefined, { ...server80, templateVersion: '5.7.44' })).toEqual([]);
    });
    test('drift to 0900_ai_ci on 8.0 is reported and repaired to general_ci', () => {
        const drifted = v80.replace(/utf8mb4_general_ci/g, 'utf8mb4_0900_ai_ci');
        const diffs = findDifferences(shape(v57), shape(drifted), undefined, { ...server80, templateVersion: '5.7.44' });
        expect(diffs.map(d => d.type)).toEqual(['mismatched_table_options', 'mismatched_field', 'mismatched_field']);
        expect(diffs[0].options).toEqual({ collate: 'utf8mb4_general_ci', charset: 'utf8mb4' });
        expect(diffs[2].field.Collate).toBe('utf8mb4_general_ci');
    });
    test('a restored table keeps general_ci on 8.0', () => {
        const [missing] = findDifferences({ tables: { t: { createSQL: v57 } } }, { tables: {} }, undefined, { ...server80, templateVersion: '5.7.44' });
        expect(missing.createSQL).toContain('DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci');
        expect(missing.createSQL).toContain('CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci DEFAULT NULL');
    });
    test('8.0 and unknown templates keep the previous behaviour', () => {
        const [missing] = findDifferences({ tables: { t: { createSQL: v57 } } }, { tables: {} }, undefined, { ...server80, templateVersion: '8.0.46' });
        expect(missing.createSQL).toBe(v57);
        expect(findDifferences(shape(v57), shape(v80.replace(/utf8mb4_general_ci/g, 'utf8mb4_0900_ai_ci')), undefined, server80)).toEqual([]);
    });
    test('a 5.7 template on a 5.7 server is unchanged', () => {
        const [missing] = findDifferences({ tables: { t: { createSQL: v57 } } }, { tables: {} }, undefined, { serverVersion: '5.7.44', templateVersion: '5.7.44' });
        expect(missing.createSQL).toBe(v57);
    });
});

describe('more 5.7 / 8.0 printing differences (from live servers)', () => {
    test('USING HASH on InnoDB is ignored; on MEMORY it still counts', () => {
        const v57 = 'CREATE TABLE `t` (\n  `b` varchar(20) DEFAULT NULL,\n  KEY `k` (`b`) USING HASH\n) ENGINE=InnoDB DEFAULT CHARSET=latin1';
        const v80 = 'CREATE TABLE `t` (\n  `b` varchar(20) DEFAULT NULL,\n  KEY `k` (`b`)\n) ENGINE=InnoDB DEFAULT CHARSET=latin1';
        expect(findDifferences(shape(v57), shape(v80))).toEqual([]);
        expect(findDifferences(shape(v80), shape(v57))).toEqual([]);
        expect(findDifferences(shape(v57.replace('InnoDB', 'MEMORY')), shape(v80.replace('InnoDB', 'MEMORY'))).map(d => d.type)).toEqual(['mismatched_index']);
    });
    test('geometrycollection and geomcollection are the same type; 5.7 gets its spelling', () => {
        const t = type => table([`\`g\` ${type} DEFAULT NULL`]);
        expect(findDifferences(shape(t('geometrycollection')), shape(t('geomcollection')))).toEqual([]);
        expect(findDifferences(shape(t('geomcollection')), shape(t('geometry'))).map(d => d.changes)).toEqual([['Type']]);
        expect(adaptSQLForServer(t('geomcollection'), '5.7.44')).toContain('`g` geometrycollection');
        expect(adaptSQLForServer("SELECT 'geomcollection'", '5.7.44')).toBe("SELECT 'geomcollection'");
    });
    const view = body => ({ tables: {}, procedures: [], views: { v: body } });
    const head = 'CREATE ALGORITHM=UNDEFINED DEFINER=`root`@`%` SQL SECURITY DEFINER VIEW `v`';
    test('view TRUE/FALSE print as 1/0 on 5.7 and true/false on 8.0', () => {
        const across = { templateVersion: '5.7.44', serverVersion: '8.0.46' };
        expect(findDifferences(view(`${head} AS select 1 AS \`t\`,0 AS \`f\` from \`base\``), view(`${head} AS select true AS \`t\`,false AS \`f\` from \`base\``), undefined, across)).toEqual([]);
        expect(findDifferences(view(`${head} AS select 'true' AS \`t\` from \`base\``), view(`${head} AS select '1' AS \`t\` from \`base\``), undefined, across).map(d => d.type)).toEqual(['mismatched_view']);
        // Within one version, `= true` and `= 1` differ against JSON in 8.0: real drift.
        const json = value => view(`${head} AS select (json_extract(\`d\`,'$.a') = ${value}) AS \`t\` from \`base\``);
        expect(findDifferences(json('true'), json('1'), undefined, { templateVersion: '8.0.46', serverVersion: '8.0.46' })).toHaveLength(1);
        expect(normalizeServerExpression('select `true`, a.true_x, @true, istrue(1), true', { booleans: true })).toBe('select `true`, a.true_x, @true, istrue(1), 1');
    });
    test('a view column list prints differently but compares equal', () => {
        const v57 = `${head} AS select \`base\`.\`id\` AS \`c1\`,concat(\`base\`.\`name\`,',') AS \`c2\` from \`base\` where (\`base\`.\`id\` in (select 1 from \`x\`))`;
        const v80 = `${head} (\`c1\`,\`c2\`) AS select \`base\`.\`id\` AS \`id\`,concat(\`base\`.\`name\`,',') AS \`concat(base.name, ',')\` from \`base\` where (\`base\`.\`id\` in (select 1 from \`x\`))`;
        expect(findDifferences(view(v57), view(v80))).toEqual([]);
        expect(findDifferences(view(v57), view(v80.replace('(`c1`,`c2`)', '(`c1`,`c3`)'))).map(d => d.type)).toEqual(['mismatched_view']);
        expect(findDifferences(view(v57), view(v80.replace("','", "';'"))).map(d => d.type)).toEqual(['mismatched_view']);
    });
});

describe('final review regressions', () => {
    const head = 'CREATE ALGORITHM=UNDEFINED DEFINER=`root`@`%` SQL SECURITY DEFINER VIEW `v`';
    const view = body => ({ tables: {}, procedures: [], views: { v: body } });
    test.each([
        ['an unbalanced paren in a string', "(`a`,`b`) AS select concat(`t`.`n`,' (') AS `x`,`t`.`id` AS `id` from `t`", "AS select concat(`t`.`n`,' (') AS `a`,`t`.`id` AS `b` from `t`"],
        ['no FROM', '(`a`) AS select 1 AS `1`', 'AS select 1 AS `a`'],
        ['a UNION whose first branch has no FROM', '(`a`) AS select 1 AS `1` union select `t`.`id` AS `id` from `t`', 'AS select 1 AS `a` union select `t`.`id` AS `id` from `t`'],
        ['", from" inside a string', "(`a`,`b`) AS select 'x, from y' AS `q`,`t`.`id` AS `id` from `t`", "AS select 'x, from y' AS `a`,`t`.`id` AS `b` from `t`"],
    ])('a view column list with %s compares equal', (_, v80, v57) => {
        expect(findDifferences(view(`${head} ${v57}`), view(`${head} ${v80}`))).toEqual([]);
    });
    test('a 5.7 template keeps its collation when its database is missing entirely', async () => {
        const fs = await import('fs/promises');
        const os = await import('os');
        const path = await import('path');
        const { compareAllDatabases } = await import('../src/compare');
        const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'msr-legacy-'));
        await fs.mkdir(path.join(dir, 'db'));
        await fs.writeFile(path.join(dir, 'dumpInfo.json'), JSON.stringify({ mysqlVersion: '5.7.44' }));
        await fs.writeFile(path.join(dir, 'db', 'db.json'), JSON.stringify({ tables: { t: { createSQL: 'CREATE TABLE `t` (\n  `x` varchar(10) DEFAULT NULL\n) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4' } } }));
        const connection = { query: async sql => {
            if (/SHOW DATABASES/i.test(sql)) return [{ Database: 'other' }];
            if (/VERSION\(\)/i.test(sql)) return [{ version: '8.0.46' }];
            if (/SHOW CHARACTER SET/i.test(sql)) return [{ Charset: 'utf8mb4', 'Default collation': 'utf8mb4_0900_ai_ci' }];
            return [];
        } };
        const diffs = await compareAllDatabases(connection, dir, false, 'compare', { quiet: true });
        expect(diffs.db.find(d => d.type === 'missing_table').createSQL).toContain('COLLATE=utf8mb4_general_ci');
        await fs.rm(dir, { recursive: true, force: true });
    });
    test('an added column of a 5.7 template states its collation', () => {
        const template = 'CREATE TABLE `t` (\n  `id` int NOT NULL,\n  `x` varchar(10) CHARACTER SET utf8mb4 DEFAULT NULL\n) ENGINE=InnoDB DEFAULT CHARSET=latin1';
        const live = 'CREATE TABLE `t` (\n  `id` int NOT NULL\n) ENGINE=InnoDB DEFAULT CHARSET=latin1';
        const [added] = findDifferences(shape(template), shape(live), undefined, { serverVersion: '8.0.46', templateVersion: '5.7.44', defaultCollations: { utf8mb4: 'utf8mb4_0900_ai_ci', latin1: 'latin1_swedish_ci' } });
        expect(added.field).toMatchObject({ Charset: 'utf8mb4', Collate: 'utf8mb4_general_ci' });
    });
    test('the template version is inferred from SQL code, not comments', async () => {
        const fs = await import('fs/promises');
        const os = await import('os');
        const path = await import('path');
        const { getTemplateVersion } = await import('../src/versions');
        const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'msr-infer-'));
        await fs.mkdir(path.join(dir, 'db'));
        await fs.writeFile(path.join(dir, 'db', 'db.json'), JSON.stringify({ tables: { t: { createSQL: "CREATE TABLE `t` (\n  `id` int(11) NOT NULL,\n  `x` varchar(10) DEFAULT NULL COMMENT 'migrated from utf8mb3'\n) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4" } } }));
        expect((await getTemplateVersion(dir)).version).toBe('5.7');
        await fs.rm(dir, { recursive: true, force: true });
    });
});

test('a collation-only table change does not report an unchanged charset', () => {
    expect(formatDifference({ type: 'mismatched_table_options', tableName: 'ft', options: { collate: 'utf8mb4_general_ci', charset: 'utf8mb4' }, currentOptions: { engine: 'InnoDB', charset: 'utf8mb4', collate: 'utf8mb4_0900_ai_ci' } }).Details)
        .toBe('Table ft options: collate is "utf8mb4_0900_ai_ci", expected "utf8mb4_general_ci"');
});
