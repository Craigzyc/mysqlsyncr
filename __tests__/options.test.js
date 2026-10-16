import fs from 'fs';
import os from 'os';
import path from 'path';
import { applyAutoIncrementOption, getTableOptions, loadSyncOptions, OPTIONS_FILE } from '../src/options';
import { findDifferences } from '../src/differences';
import { findMissingRows } from '../src/rows';
import { applyDifferences } from '../src/apply';
import { rebuildTemplate } from '../src/rebuild';
import { parseCreateTableSQL } from '../src/parsers';

const createSQL = `CREATE TABLE \`AlarmRules\` (
  \`idAlarmRule\` int NOT NULL AUTO_INCREMENT,
  \`name\` varchar(45) NOT NULL DEFAULT 'System Generated',
  PRIMARY KEY (\`idAlarmRule\`)
) ENGINE=InnoDB AUTO_INCREMENT=400101 DEFAULT CHARSET=latin1`;

const tempDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'mysqlsyncr-'));

describe('applyAutoIncrementOption', () => {
    test('true keeps the counter', () => {
        expect(applyAutoIncrementOption(createSQL, true)).toBe(createSQL);
    });

    test('false removes the counter but not the column attribute', () => {
        const result = applyAutoIncrementOption(createSQL, false);
        expect(result).not.toContain('AUTO_INCREMENT=');
        expect(result).toContain('`idAlarmRule` int NOT NULL AUTO_INCREMENT,');
        expect(result).toContain(') ENGINE=InnoDB DEFAULT CHARSET=latin1');
    });

    test('a number sets the counter', () => {
        expect(applyAutoIncrementOption(createSQL, 1000)).toContain(') ENGINE=InnoDB AUTO_INCREMENT=1000 DEFAULT CHARSET=latin1');
        expect(applyAutoIncrementOption('CREATE TABLE `t` (\n  `id` int\n);', 5)).toBe('CREATE TABLE `t` (\n  `id` int\n) AUTO_INCREMENT=5;');
    });
});

describe('sync options file', () => {
    test('a missing file means no options', async () => {
        expect(await loadSyncOptions(tempDir())).toEqual({});
    });

    test('table options override the default', () => {
        const options = { autoIncrement: false, databases: { Alerts: { AlarmRules: { autoIncrement: 1000 } } } };
        expect(getTableOptions(options, 'Alerts', 'AlarmRules').autoIncrement).toBe(1000);
        expect(getTableOptions(options, 'Alerts', 'Other').autoIncrement).toBe(false);
        expect(getTableOptions({}, 'Alerts', 'Other').autoIncrement).toBe(true);
    });

    test('rejects invalid values', async () => {
        const dir = tempDir();
        fs.writeFileSync(path.join(dir, OPTIONS_FILE), JSON.stringify({ databases: { Alerts: { AlarmRules: { autoIncrement: 'yes' } } } }));
        await expect(loadSyncOptions(dir)).rejects.toThrow('Alerts.AlarmRules.autoIncrement');
        fs.writeFileSync(path.join(dir, OPTIONS_FILE), JSON.stringify({ databases: { Alerts: { AlarmRules: { rows: { id: 1 } } } } }));
        await expect(loadSyncOptions(dir)).rejects.toThrow('rows must be an array');
    });
});

describe('missing_table with the autoIncrement option', () => {
    const template = { tables: { AlarmRules: { ...parseCreateTableSQL(createSQL), triggers: [], createSQL } }, procedures: [] };
    const empty = { tables: {}, procedures: [] };

    test('creates the table without the dumped counter', () => {
        const [diff] = findDifferences(template, empty, () => ({ autoIncrement: false }));
        expect(diff.type).toBe('missing_table');
        expect(diff.createSQL).not.toContain('AUTO_INCREMENT=');
    });

    test('tables differing only by counter match', () => {
        const live = { tables: { AlarmRules: { ...template.tables.AlarmRules, createSQL: createSQL.replace('400101', '7') } }, procedures: [] };
        expect(findDifferences(template, live)).toEqual([]);
    });
});

describe('seed rows', () => {
    const expected = { tables: { AlarmRules: parseCreateTableSQL(createSQL) } };
    const options = { databases: { Alerts: { AlarmRules: { rows: [{ idAlarmRule: 1, name: 'Default' }, { idAlarmRule: 2, name: 'Other' }] } } } };

    test('reports only rows whose primary key is not found', async () => {
        const queries = [];
        const connection = {
            query: async (sql, values) => {
                queries.push({ sql, values });
                return values[0] === 1 ? [{ 1: 1 }] : [];
            }
        };
        const diffs = await findMissingRows(connection, 'Alerts', expected, expected, options);
        expect(queries[0]).toEqual({ sql: 'SELECT 1 FROM `Alerts`.`AlarmRules` WHERE `idAlarmRule` = ? LIMIT 1', values: [1] });
        expect(diffs).toEqual([{ type: 'missing_row', tableName: 'AlarmRules', key: { idAlarmRule: 2 }, row: { idAlarmRule: 2, name: 'Other' } }]);
    });

    test('every row is missing when the table is missing, without querying it', async () => {
        const connection = { query: jest.fn() };
        const diffs = await findMissingRows(connection, 'Alerts', expected, { tables: {} }, options);
        expect(diffs).toHaveLength(2);
        expect(connection.query).not.toHaveBeenCalled();
    });

    test('uses rowKey and requires it on each row', async () => {
        const keyed = { databases: { Alerts: { AlarmRules: { rowKey: ['name'], rows: [{ name: 'Default' }] } } } };
        const connection = { query: async () => [] };
        const [diff] = await findMissingRows(connection, 'Alerts', expected, expected, keyed);
        expect(diff.key).toEqual({ name: 'Default' });
        const bad = { databases: { Alerts: { AlarmRules: { rows: [{ name: 'Default' }] } } } };
        await expect(findMissingRows(connection, 'Alerts', expected, expected, bad)).rejects.toThrow('missing rowKey column(s) idAlarmRule');
    });

    test('rows are inserted after the table is created', async () => {
        const statements = [];
        const connection = { query: async (sql, values) => { if (!sql.startsWith('USE') && !sql.startsWith('SELECT VERSION') && !sql.startsWith('SET SESSION')) statements.push({ sql, values }); return []; } };
        await applyDifferences(connection, 'Alerts', [
            { type: 'missing_row', tableName: 'AlarmRules', key: { idAlarmRule: 1 }, row: { idAlarmRule: 1, name: "it's" } },
            { type: 'missing_table', tableName: 'AlarmRules', createSQL: 'CREATE TABLE ...' }
        ]);
        expect(statements).toEqual([
            { sql: 'CREATE TABLE ...', values: undefined },
            { sql: 'INSERT INTO `AlarmRules` (`idAlarmRule`, `name`) VALUES (?, ?);', values: [1, "it's"] }
        ]);
    });
});

describe('rebuildTemplate', () => {
    const writeTemplate = (dir, table) => {
        fs.mkdirSync(path.join(dir, 'Alerts', 'tables'), { recursive: true });
        fs.writeFileSync(path.join(dir, 'Alerts', 'Alerts.json'), JSON.stringify({ tables: { AlarmRules: table } }));
        fs.writeFileSync(path.join(dir, 'Alerts', 'tables', 'AlarmRules.sql'), `${table.createSQL}\n`);
    };
    // what the old parser produced: the default cut at the space
    const oldTable = () => ({
        columns: [
            { Field: 'idAlarmRule', Type: 'int', NotNull: true, AutoIncrement: true },
            { Field: 'name', Type: 'varchar(45)', NotNull: true, Default: 'System' }
        ],
        indexes: [{ ColumnName: ['idAlarmRule'], Primary: true, Name: 'PRIMARY' }],
        triggers: [],
        createSQL
    });

    test('dry run reports changes without writing', async () => {
        const dir = tempDir();
        writeTemplate(dir, oldTable());
        const before = fs.readFileSync(path.join(dir, 'Alerts', 'Alerts.json'), 'utf-8');
        const { changes: report } = await rebuildTemplate(dir);
        expect(report['Alerts.AlarmRules']).toEqual([
            'column name: JSON {"Type":"varchar(45)","NotNull":true,"Default":"System"} -> createSQL {"Type":"varchar(45)","NotNull":true,"Default":"System Generated"}'
        ]);
        expect(fs.readFileSync(path.join(dir, 'Alerts', 'Alerts.json'), 'utf-8')).toBe(before);
    });

    test('--write rebuilds the JSON and applies the autoIncrement option', async () => {
        const dir = tempDir();
        writeTemplate(dir, oldTable());
        fs.writeFileSync(path.join(dir, OPTIONS_FILE), JSON.stringify({ autoIncrement: false }));
        await rebuildTemplate(dir, { write: true });
        const table = JSON.parse(fs.readFileSync(path.join(dir, 'Alerts', 'Alerts.json'), 'utf-8')).tables.AlarmRules;
        expect(table.columns[1].Default).toBe('System Generated');
        expect(table.createSQL).not.toContain('AUTO_INCREMENT=');
        expect(table.triggers).toEqual([]);
        expect(fs.readFileSync(path.join(dir, 'Alerts', 'tables', 'AlarmRules.sql'), 'utf-8')).not.toContain('AUTO_INCREMENT=');
        expect((await rebuildTemplate(dir)).changes).toEqual({});
    });
});

describe('definer option', () => {
    const { formatDefiner, applyDefiner, applyDefinerOption } = require('../src/options');
    const procedure = 'CREATE DEFINER=`neelands`@`localhost` PROCEDURE `P`()\nBEGIN\n  SELECT 1;\nEND';

    test('accepts the usual ways of writing user@host', () => {
        expect(formatDefiner('root@%')).toBe('`root`@`%`');
        expect(formatDefiner("'root'@'localhost'")).toBe('`root`@`localhost`');
        expect(formatDefiner('DEFINER=`root`@`%`')).toBe('`root`@`%`');
        expect(formatDefiner('root')).toBeNull();
    });

    test('rejects an invalid definer in the options file', async () => {
        const dir = tempDir();
        fs.writeFileSync(path.join(dir, OPTIONS_FILE), JSON.stringify({ definer: 'root' }));
        await expect(loadSyncOptions(dir)).rejects.toThrow('definer must look like');
    });

    test('replaces only the DEFINER clause', () => {
        expect(applyDefiner(procedure, 'root@%')).toBe(procedure.replace('`neelands`@`localhost`', '`root`@`%`'));
        const view = 'CREATE ALGORITHM=UNDEFINED DEFINER=`a`@`b` SQL SECURITY DEFINER VIEW `v` AS select 1';
        expect(applyDefiner(view, 'root@%')).toBe('CREATE ALGORITHM=UNDEFINED DEFINER=`root`@`%` SQL SECURITY DEFINER VIEW `v` AS select 1');
        expect(applyDefiner(procedure, undefined)).toBe(procedure);
    });

    test('applies to procedures, views and triggers without changing the original', () => {
        const structure = {
            tables: { t: { columns: [], indexes: [], triggers: [{ Name: 'trg', Definition: 'CREATE DEFINER=`x`@`y` TRIGGER `trg` BEFORE INSERT ON `t` FOR EACH ROW SET @a = 1' }] } },
            procedures: [{ Name: 'P', Definition: procedure }],
            views: { v: 'CREATE DEFINER=`x`@`y` VIEW `v` AS select 1' }
        };
        const result = applyDefinerOption(structure, 'root@%');
        expect(result.procedures[0].Definition).toContain('DEFINER=`root`@`%`');
        expect(result.views.v).toContain('DEFINER=`root`@`%`');
        expect(result.tables.t.triggers[0].Definition).toContain('DEFINER=`root`@`%`');
        expect(structure.procedures[0].Definition).toBe(procedure);
    });

    test('a database object with another definer is reported, and one with the option definer is not', () => {
        const template = applyDefinerOption({ tables: {}, procedures: [{ Name: 'P', Definition: procedure }] }, 'root@%');
        const differentDefiner = { tables: {}, procedures: [{ Name: 'P', Definition: procedure }] };
        const sameDefiner = { tables: {}, procedures: [{ Name: 'P', Definition: applyDefiner(procedure, 'root@%') }] };
        const [diff] = findDifferences(template, differentDefiner);
        expect(diff).toMatchObject({ type: 'mismatched_procedure', Definition: applyDefiner(procedure, 'root@%') });
        expect(findDifferences(template, sameDefiner)).toEqual([]);
    });
});

describe('trigger comparison', () => {
    const table = (definition) => ({
        tables: { t: { columns: [], indexes: [], triggers: [{ Name: 'trg', Definition: definition }], createSQL: 'CREATE TABLE `t` (\n  `a` int\n)' } },
        procedures: []
    });
    const trigger = 'CREATE DEFINER=`root`@`%` TRIGGER `trg` BEFORE INSERT ON `t` FOR EACH ROW SET NEW.a = 1';

    test('a changed trigger body is reported with both definitions', () => {
        const diffs = findDifferences(table(trigger), table(trigger.replace('= 1', '= 2')));
        expect(diffs).toHaveLength(1);
        expect(diffs[0]).toMatchObject({ type: 'mismatched_trigger', trigger: { Definition: trigger }, currentTrigger: { Definition: trigger.replace('= 1', '= 2') } });
    });

    test('whitespace-only changes are not', () => {
        expect(findDifferences(table(trigger), table(trigger.replace(' FOR EACH', '\n  FOR   EACH')))).toEqual([]);
    });
});

describe('rebuildTemplate and tables/*.sql', () => {
    const setup = (sqlFile) => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mysqlsyncr-'));
        fs.mkdirSync(path.join(dir, 'Alerts', 'tables'), { recursive: true });
        const clean = createSQL.replace(' AUTO_INCREMENT=400101', '');
        const parsed = parseCreateTableSQL(clean);
        fs.writeFileSync(path.join(dir, 'Alerts', 'Alerts.json'), JSON.stringify({ tables: { AlarmRules: { columns: parsed.columns, indexes: parsed.indexes, constraints: [], triggers: [], createSQL: clean } } }));
        fs.writeFileSync(path.join(dir, OPTIONS_FILE), JSON.stringify({ autoIncrement: false }));
        fs.writeFileSync(path.join(dir, 'Alerts', 'tables', 'AlarmRules.sql'), sqlFile);
        return { dir, clean, read: () => fs.readFileSync(path.join(dir, 'Alerts', 'tables', 'AlarmRules.sql'), 'utf-8'), json: () => fs.readFileSync(path.join(dir, 'Alerts', 'Alerts.json'), 'utf-8') };
    };

    test('only the counter is removed from a .sql file, keeping notes written in it', async () => {
        const notes = '\n-- Notes about these columns, written by hand\n';
        const { dir, clean, read, json } = setup(`${createSQL};\n${notes}`);
        const jsonBefore = json();
        expect((await rebuildTemplate(dir)).changes).toEqual({ 'Alerts.AlarmRules': ['tables/AlarmRules.sql: AUTO_INCREMENT counter changed by the autoIncrement option'] });
        await rebuildTemplate(dir, { write: true });
        expect(read()).toBe(`${clean};\n${notes}`);
        expect(json()).toBe(jsonBefore);
        expect(await rebuildTemplate(dir)).toMatchObject({ changes: {} });
    });

    test('other differences in a .sql file are reported, not overwritten', async () => {
        const edited = createSQL.replace(' AUTO_INCREMENT=400101', '').replace('  PRIMARY KEY', '  `extra` int DEFAULT NULL,\n  PRIMARY KEY');
        const { dir, read } = setup(`${edited}\n`);
        const { changes, notes } = await rebuildTemplate(dir, { write: true });
        expect(changes).toEqual({});
        expect(notes['Alerts.AlarmRules']).toContain('differs from the createSQL');
        expect(read()).toBe(`${edited}\n`);
    });
});
