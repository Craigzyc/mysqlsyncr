import fs from 'fs/promises';
import path from 'path';
import { parseCreateTableSQL } from './parsers.js';
import { assertOutsidePackage } from './paths.js';

/**
 * Split a tables/<table>.sql file into its CREATE TABLE statement (without a
 * trailing semicolon) and whatever follows it, such as notes written by hand.
 */
export const splitSqlFile = (content) => {
    const lines = content.replace(/\r\n/g, '\n').split('\n');
    const start = lines.findIndex(line => /^\s*CREATE TABLE/i.test(line));
    let end = start === -1 ? -1 : lines.findIndex((line, i) => i > start && line.trim().startsWith(')'));
    if (start === -1 || end === -1) return { statement: content.trim(), semicolon: false, before: '', after: '' };
    const closing = lines[end].replace(/\s+$/, '');
    const semicolon = closing.endsWith(';');
    return {
        before: lines.slice(0, start).join('\n'),
        statement: [...lines.slice(start, end), semicolon ? closing.slice(0, -1) : closing].join('\n'),
        semicolon,
        after: lines.slice(end + 1).join('\n')
    };
}

const joinSqlFile = ({ before, statement, semicolon, after }) =>
    `${before ? `${before}\n` : ''}${statement}${semicolon ? ';' : ''}\n${after.trim() ? `${after.replace(/\n+$/, '')}\n` : ''}`;

const sameStatement = (a, b) => a.replace(/\r\n/g, '\n').replace(/;?\s*$/, '') === b.replace(/\r\n/g, '\n').replace(/;?\s*$/, '');

/**
 * Tables whose tables/<table>.sql statement differs from the createSQL in the
 * database's JSON (which is what comparing uses). Notes after the statement
 * don't count. Returns [{ database, table, file, json, sql }].
 */
export const findTemplateDrift = async (dir) => {
    const drift = [];
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries.filter(e => e.isDirectory())) {
        const database = entry.name;
        let structure;
        try {
            structure = JSON.parse(await fs.readFile(path.join(dir, database, `${database}.json`), 'utf-8'));
        } catch {
            continue;
        }
        for (const [table, contents] of Object.entries(structure.tables || {})) {
            if (!contents.createSQL) continue;
            const file = path.join('tables', `${table}.sql`);
            const content = await fs.readFile(path.join(dir, database, file), 'utf-8').catch(() => null);
            if (content === null) continue;
            const { statement } = splitSqlFile(content);
            if (!sameStatement(statement, contents.createSQL)) {
                drift.push({ database, table, file: file.replace(/\\/g, '/'), json: contents.createSQL.replace(/;\s*$/, ''), sql: statement });
            }
        }
    }
    return drift;
}

/**
 * Make one table's JSON createSQL and tables/<table>.sql agree.
 *   keep 'json': the .sql file's statement is replaced by the JSON's createSQL; notes after it stay
 *   keep 'sql':  the JSON's createSQL becomes the .sql file's statement, and its
 *                columns/indexes/constraints are re-read from it
 */
export const resolveTemplateDrift = async (dir, database, table, keep) => {
    if (keep !== 'json' && keep !== 'sql') throw new Error(`keep must be 'json' or 'sql', not ${keep}`);
    assertOutsidePackage(dir);
    const jsonPath = path.join(dir, database, `${database}.json`);
    const sqlPath = path.join(dir, database, 'tables', `${table}.sql`);
    const structure = JSON.parse(await fs.readFile(jsonPath, 'utf-8'));
    const contents = structure.tables?.[table];
    if (!contents?.createSQL) throw new Error(`${database}.${table} has no createSQL in ${database}.json`);
    const parts = splitSqlFile(await fs.readFile(sqlPath, 'utf-8'));

    if (keep === 'json') {
        await fs.writeFile(sqlPath, joinSqlFile({ ...parts, statement: contents.createSQL.replace(/;\s*$/, '') }), 'utf-8');
        return;
    }

    const parsed = parseCreateTableSQL(parts.statement);
    if (!parsed || parsed.name !== table) {
        throw new Error(`tables/${table}.sql doesn't hold a CREATE TABLE for ${table}`);
    }
    structure.tables[table] = {
        ...contents,
        columns: parsed.columns,
        indexes: parsed.indexes,
        constraints: parsed.constraints,
        createSQL: parts.statement
    };
    await fs.writeFile(jsonPath, JSON.stringify(structure, null, 4), 'utf-8');
}
