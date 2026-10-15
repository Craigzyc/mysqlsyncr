import fs from 'fs';
import os from 'os';
import path from 'path';
import { replaceCreateSQLElement, acceptCurrentIntoTemplate } from '../src/acceptCurrent';
import { parseCreateTableSQL } from '../src/parsers';
import { findDifferences } from '../src/differences';

const templateSQL = `CREATE TABLE \`E2Data\` (
  \`IID\` varchar(25) DEFAULT NULL,
  \`DeviceId\` varchar(45) NOT NULL,
  \`oldColumn\` int DEFAULT NULL,
  PRIMARY KEY (\`IID\`),
  KEY \`IndexIID\` (\`IID\`)
) ENGINE=InnoDB DEFAULT CHARSET=latin1`;

const liveSQL = `CREATE TABLE \`E2Data\` (
  \`IID\` varchar(25) DEFAULT NULL,
  \`DeviceId\` varchar(75) NOT NULL,
  \`newColumn\` int NOT NULL DEFAULT '0',
  PRIMARY KEY (\`IID\`),
  KEY \`IndexIID\` (\`IID\`,\`DeviceId\`),
  KEY \`idx_new\` (\`newColumn\`)
) ENGINE=InnoDB AUTO_INCREMENT=55 DEFAULT CHARSET=latin1`;

describe('replaceCreateSQLElement', () => {
    test('replaces a changed column line', () => {
        const result = replaceCreateSQLElement(templateSQL, liveSQL, 'col:DeviceId');
        expect(result).toContain('  `DeviceId` varchar(75) NOT NULL,\n');
        expect(result.split('\n')).toHaveLength(templateSQL.split('\n').length);
    });

    test('removes a column the database does not have', () => {
        expect(replaceCreateSQLElement(templateSQL, liveSQL, 'col:oldColumn')).not.toContain('oldColumn');
    });

    test('adds a column after the one before it in the database', () => {
        const result = replaceCreateSQLElement(templateSQL, liveSQL, 'col:newColumn');
        expect(result).toContain("  `DeviceId` varchar(45) NOT NULL,\n  `newColumn` int NOT NULL DEFAULT '0',\n  `oldColumn`");
    });

    test('adds, replaces and removes indexes, keeping commas valid', () => {
        let result = replaceCreateSQLElement(templateSQL, liveSQL, 'idx:idx_new');
        expect(result).toContain('  KEY `IndexIID` (`IID`),\n  KEY `idx_new` (`newColumn`)\n) ENGINE');
        result = replaceCreateSQLElement(result, liveSQL, 'idx:IndexIID');
        expect(result).toContain('KEY `IndexIID` (`IID`,`DeviceId`),');
        result = replaceCreateSQLElement(result, templateSQL, 'idx:idx_new');
        expect(result).toContain('  KEY `IndexIID` (`IID`,`DeviceId`)\n) ENGINE');
        expect(parseCreateTableSQL(result).indexes.map(i => i.Name)).toEqual(['PRIMARY', 'IndexIID']);
    });

    test('leaves the AUTO_INCREMENT counter of the template alone', () => {
        expect(replaceCreateSQLElement(templateSQL, liveSQL, 'col:DeviceId')).not.toContain('AUTO_INCREMENT=');
    });
});

describe('acceptCurrentIntoTemplate', () => {
    // Answers the queries getDatabaseStructure makes for a database holding liveSQL
    const liveConnection = () => ({
        query: async (sql) => {
            if (sql.startsWith('SHOW FULL TABLES WHERE')) return [{ Tables_in_db: 'E2Data' }];
            if (sql.startsWith('SHOW CREATE TABLE')) return [{ 'Create Table': liveSQL }];
            return [];
        }
    });

    const writeTemplate = () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mysqlsyncr-accept-'));
        fs.mkdirSync(path.join(dir, 'currentCOMPortData', 'tables'), { recursive: true });
        const parsed = parseCreateTableSQL(templateSQL);
        const template = {
            tables: {
                E2Data: { columns: parsed.columns, indexes: parsed.indexes, constraints: [], triggers: [], createSQL: templateSQL },
                Dropped: { columns: [], indexes: [], constraints: [], triggers: [], createSQL: 'CREATE TABLE `Dropped` (\n  `a` int\n)' }
            },
            procedures: []
        };
        fs.writeFileSync(path.join(dir, 'currentCOMPortData', 'currentCOMPortData.json'), JSON.stringify(template));
        fs.writeFileSync(path.join(dir, 'currentCOMPortData', 'tables', 'Dropped.sql'), 'x');
        return dir;
    };
    const readTemplate = (dir) => JSON.parse(fs.readFileSync(path.join(dir, 'currentCOMPortData', 'currentCOMPortData.json'), 'utf-8'));

    test('keeping every difference leaves none', async () => {
        const dir = writeTemplate();
        const live = { tables: { E2Data: { ...parseCreateTableSQL(liveSQL), triggers: [], createSQL: liveSQL } }, procedures: [] };
        const diffs = findDifferences(readTemplate(dir), live);
        expect(diffs.map(d => d.type).sort()).toEqual(['extra_field', 'extra_index', 'extra_index', 'missing_field', 'missing_table', 'mismatched_field'].sort());

        await acceptCurrentIntoTemplate(liveConnection(), dir, 'currentCOMPortData', diffs);

        const template = readTemplate(dir);
        expect(findDifferences(template, live)).toEqual([]);
        expect(template.tables.Dropped).toBeUndefined();
        expect(fs.existsSync(path.join(dir, 'currentCOMPortData', 'tables', 'Dropped.sql'))).toBe(false);
        expect(fs.readFileSync(path.join(dir, 'currentCOMPortData', 'tables', 'E2Data.sql'), 'utf-8')).toBe(`${template.tables.E2Data.createSQL}\n`);
    });

    test('only the chosen difference changes', async () => {
        const dir = writeTemplate();
        await acceptCurrentIntoTemplate(liveConnection(), dir, 'currentCOMPortData', [
            { type: 'mismatched_field', info: 'Type', tableName: 'E2Data', field: { Field: 'DeviceId', Type: 'varchar(45)', NotNull: true } }
        ]);
        const table = readTemplate(dir).tables.E2Data;
        expect(table.columns.map(c => c.Field)).toEqual(['IID', 'DeviceId', 'oldColumn']);
        expect(table.columns[1].Type).toBe('varchar(75)');
        expect(table.indexes.find(i => i.Name === 'IndexIID').ColumnName).toEqual(['IID']);
    });

    test('saves what it can and reports the rest', async () => {
        const dir = writeTemplate();
        await expect(acceptCurrentIntoTemplate(liveConnection(), dir, 'currentCOMPortData', [
            { type: 'missing_row', tableName: 'E2Data', key: { IID: 'x' }, row: { IID: 'x' } },
            { type: 'missing_table', tableName: 'Dropped' }
        ])).rejects.toMatchObject({ errors: [{ difference: 'missing_row E2Data' }] });
        expect(readTemplate(dir).tables.Dropped).toBeUndefined();
    });
});
