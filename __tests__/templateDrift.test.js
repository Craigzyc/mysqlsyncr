import fs from 'fs';
import os from 'os';
import path from 'path';
import { splitSqlFile, findTemplateDrift, resolveTemplateDrift } from '../src/templateDrift';
import { parseCreateTableSQL } from '../src/parsers';

const jsonSQL = `CREATE TABLE \`CurrentValues\` (
  \`mapplicID\` varchar(150) NOT NULL,
  \`lastValueUpdated\` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (\`mapplicID\`)
) ENGINE=InnoDB DEFAULT CHARSET=latin1`;
const olderSQL = jsonSQL.replace('  `lastValueUpdated` timestamp NULL DEFAULT NULL,\n', '');
const notes = '\n-- Notes about these columns, written by hand\n-- that must survive either choice\n';

const setup = (sqlFile) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mysqlsyncr-drift-'));
    fs.mkdirSync(path.join(dir, 'currentCOMPortData', 'tables'), { recursive: true });
    const parsed = parseCreateTableSQL(jsonSQL);
    fs.writeFileSync(path.join(dir, 'currentCOMPortData', 'currentCOMPortData.json'),
        JSON.stringify({ tables: { CurrentValues: { columns: parsed.columns, indexes: parsed.indexes, constraints: [], triggers: [{ Name: 't' }], createSQL: jsonSQL } } }));
    fs.writeFileSync(path.join(dir, 'currentCOMPortData', 'tables', 'CurrentValues.sql'), sqlFile);
    return {
        dir,
        sqlFile: () => fs.readFileSync(path.join(dir, 'currentCOMPortData', 'tables', 'CurrentValues.sql'), 'utf-8'),
        table: () => JSON.parse(fs.readFileSync(path.join(dir, 'currentCOMPortData', 'currentCOMPortData.json'), 'utf-8')).tables.CurrentValues
    };
};

describe('splitSqlFile', () => {
    test('separates the statement from notes after it', () => {
        expect(splitSqlFile(`${olderSQL};\n${notes}`)).toEqual({ before: '', statement: olderSQL, semicolon: true, after: notes });
    });
});

describe('findTemplateDrift', () => {
    test('notes after the statement are not a difference', async () => {
        const { dir } = setup(`${jsonSQL};\n${notes}`);
        expect(await findTemplateDrift(dir)).toEqual([]);
    });

    test('a different statement is reported with both versions', async () => {
        const { dir } = setup(`${olderSQL}\n`);
        expect(await findTemplateDrift(dir)).toEqual([
            { database: 'currentCOMPortData', table: 'CurrentValues', file: 'tables/CurrentValues.sql', json: jsonSQL, sql: olderSQL }
        ]);
    });
});

describe('resolveTemplateDrift', () => {
    test('keeping the JSON rewrites the statement in the .sql file but keeps its notes', async () => {
        const { dir, sqlFile } = setup(`${olderSQL};\n${notes}`);
        await resolveTemplateDrift(dir, 'currentCOMPortData', 'CurrentValues', 'json');
        expect(sqlFile()).toBe(`${jsonSQL};\n${notes}`);
        expect(await findTemplateDrift(dir)).toEqual([]);
    });

    test('keeping the .sql file updates the JSON createSQL, columns and indexes', async () => {
        const { dir, sqlFile, table } = setup(`${olderSQL};\n${notes}`);
        await resolveTemplateDrift(dir, 'currentCOMPortData', 'CurrentValues', 'sql');
        expect(table().createSQL).toBe(olderSQL);
        expect(table().columns.map(c => c.Field)).toEqual(['mapplicID']);
        expect(table().triggers).toEqual([{ Name: 't' }]);
        expect(sqlFile()).toBe(`${olderSQL};\n${notes}`);
        expect(await findTemplateDrift(dir)).toEqual([]);
    });

    test('refuses an unknown choice or a file for another table', async () => {
        const { dir } = setup(olderSQL.replace('`CurrentValues`', '`Other`'));
        await expect(resolveTemplateDrift(dir, 'currentCOMPortData', 'CurrentValues', 'both')).rejects.toThrow("keep must be 'json' or 'sql'");
        await expect(resolveTemplateDrift(dir, 'currentCOMPortData', 'CurrentValues', 'sql')).rejects.toThrow("doesn't hold a CREATE TABLE for CurrentValues");
    });
});
