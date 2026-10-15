import fs from 'fs/promises';
import path from 'path';
import { getDatabaseStructure } from './getters.js';
import { parseCreateTableSQL } from './parsers.js';
import { loadSyncOptions, getTableOptions, applyAutoIncrementOption, applyDefinerOption } from './options.js';
import { assertOutsidePackage } from './paths.js';

// --- Editing one column or index line of a CREATE TABLE statement ---

// 'col:name' for a column line, 'idx:name' for an index line ('idx:PRIMARY' for the primary key), else null
const elementKey = (line) => {
    const column = line.match(/^\s*`([^`]+)`\s/);
    if (column) return `col:${column[1]}`;
    if (/^\s*PRIMARY KEY\b/i.test(line)) return 'idx:PRIMARY';
    const index = line.match(/^\s*(?:UNIQUE |FULLTEXT |SPATIAL )?KEY\s+`([^`]+)`/i);
    if (index) return `idx:${index[1]}`;
    return null;
}

// Split into the CREATE TABLE line, the definition lines (without their separating commas) and the closing line onwards
const splitCreateSQL = (sql) => {
    const lines = sql.replace(/\r\n/g, '\n').split('\n');
    let end = lines.length - 1;
    while (end > 0 && !lines[end].trim().startsWith(')')) end--;
    if (end <= 0) throw new Error('Could not find the column definitions in the CREATE TABLE statement');
    return {
        head: lines[0],
        body: lines.slice(1, end).map(line => line.replace(/,\s*$/, '')),
        tail: lines.slice(end).join('\n')
    };
}

const joinCreateSQL = ({ head, body, tail }) => [head, ...body.map((line, i) => i < body.length - 1 ? `${line},` : line), tail].join('\n');

/**
 * Make the template's line for one column or index match the live table: replace
 * it, remove it when the live table doesn't have it, or add it after the element
 * that precedes it in the live table.
 */
export const replaceCreateSQLElement = (templateSQL, liveSQL, key) => {
    const template = splitCreateSQL(templateSQL);
    const live = splitCreateSQL(liveSQL);
    const templateIndex = template.body.findIndex(line => elementKey(line) === key);
    const liveIndex = live.body.findIndex(line => elementKey(line) === key);

    if (liveIndex === -1) {
        if (templateIndex !== -1) template.body.splice(templateIndex, 1);
    } else if (templateIndex !== -1) {
        template.body[templateIndex] = live.body[liveIndex];
    } else {
        const kind = key.slice(0, 4);
        let insertAt = -1;
        for (let i = liveIndex - 1; i >= 0 && insertAt === -1; i--) {
            const previousKey = elementKey(live.body[i]);
            if (previousKey?.startsWith(kind)) {
                const position = template.body.findIndex(line => elementKey(line) === previousKey);
                if (position !== -1) insertAt = position + 1;
            }
        }
        if (insertAt === -1) {
            // First of its kind: columns go first, indexes go after the last column
            const lastColumn = template.body.reduce((last, line, i) => elementKey(line)?.startsWith('col:') ? i : last, -1);
            insertAt = kind === 'col:' ? 0 : lastColumn + 1;
        }
        template.body.splice(insertAt, 0, live.body[liveIndex]);
    }
    return joinCreateSQL(template);
}

// --- Applying differences to the template ---

const tableFile = (tableName) => path.join('tables', `${tableName}.sql`);

const requireTable = (structure, tableName, which) => {
    const table = structure.tables?.[tableName];
    if (!table) throw new Error(`Table ${tableName} is not in the ${which}`);
    return table;
}

// Rebuild the template's list of columns or indexes in createSQL order, using the
// live entry for the changed element and keeping the template's other entries
const syncEntries = (templateEntries = [], parsedEntries, liveEntries, nameKey, changedName) =>
    parsedEntries.map(entry => {
        const name = entry[nameKey];
        if (name === changedName) return liveEntries.find(e => e[nameKey] === name) ?? entry;
        return templateEntries.find(e => e[nameKey] === name) ?? entry;
    });

const acceptTableElement = (template, current, diff, files) => {
    const templateTable = requireTable(template, diff.tableName, 'template');
    const currentTable = requireTable(current, diff.tableName, 'database');
    if (!templateTable.createSQL) throw new Error(`Table ${diff.tableName} has no createSQL in the template`);

    const isField = diff.type.endsWith('_field');
    const name = isField ? diff.field.Field : (diff.indexName ?? diff.index?.Name);
    const createSQL = replaceCreateSQLElement(templateTable.createSQL, currentTable.createSQL, `${isField ? 'col' : 'idx'}:${name}`);
    const parsed = parseCreateTableSQL(createSQL);

    templateTable.createSQL = createSQL;
    if (isField) {
        templateTable.columns = syncEntries(templateTable.columns, parsed.columns, currentTable.columns, 'Field', name);
    } else {
        templateTable.indexes = syncEntries(templateTable.indexes, parsed.indexes, currentTable.indexes, 'Name', name);
    }
    files.set(tableFile(diff.tableName), createSQL);
}

const acceptDifference = (template, current, diff, { database, syncOptions, files }) => {
    switch (diff.type) {
        case 'extra_table': {
            const table = requireTable(current, diff.tableName, 'database');
            const createSQL = applyAutoIncrementOption(table.createSQL, getTableOptions(syncOptions, database, diff.tableName).autoIncrement);
            template.tables[diff.tableName] = { ...table, createSQL };
            files.set(tableFile(diff.tableName), createSQL);
            for (const trigger of table.triggers || []) {
                files.set(path.join('tables', 'triggers', `${trigger.Name}.sql`), trigger.Definition);
            }
            break;
        }
        case 'missing_table':
            delete template.tables[diff.tableName];
            files.set(tableFile(diff.tableName), null);
            break;

        case 'missing_field':
        case 'extra_field':
        case 'mismatched_field':
        case 'missing_index':
        case 'extra_index':
        case 'mismatched_index':
            acceptTableElement(template, current, diff, files);
            break;

        case 'missing_trigger':
        case 'extra_trigger':
        case 'mismatched_trigger': {
            const templateTable = requireTable(template, diff.tableName, 'template');
            const liveTrigger = current.tables?.[diff.tableName]?.triggers?.find(t => t.Name === diff.trigger.Name);
            templateTable.triggers = (templateTable.triggers || []).filter(t => t.Name !== diff.trigger.Name);
            if (liveTrigger) templateTable.triggers.push(liveTrigger);
            files.set(path.join('tables', 'triggers', `${diff.trigger.Name}.sql`), liveTrigger?.Definition ?? null);
            break;
        }

        case 'missing_procedure':
        case 'mismatched_procedure': {
            const liveProcedure = current.procedures?.find(p => p.Name === diff.Name);
            const procedures = (template.procedures || []).filter(p => p.Name !== diff.Name);
            if (liveProcedure) procedures.push(liveProcedure);
            template.procedures = procedures;
            files.set(path.join('procedures', `${diff.Name}.sql`), liveProcedure?.Definition ?? null);
            break;
        }

        case 'missing_view':
        case 'extra_view':
        case 'mismatched_view': {
            const liveView = current.views?.[diff.viewName];
            template.views = { ...template.views };
            if (liveView) template.views[diff.viewName] = liveView;
            else delete template.views[diff.viewName];
            files.set(path.join('views', `${diff.viewName}.sql`), liveView ?? null);
            break;
        }

        default:
            throw new Error(`${diff.type} can't be kept as the current value; edit the template or sync options instead`);
    }
}

const describeDifference = (diff) => {
    const name = diff.tableName || diff.viewName || diff.Name || diff.database || '';
    const detail = diff.field?.Field || diff.indexName || diff.trigger?.Name || '';
    return `${diff.type} ${name}${detail ? '.' + detail : ''}`;
}

/**
 * The opposite of applyDifferences: change the template so it matches the live
 * database for each difference, instead of changing the database. Updates
 * <templateDir>/<database>/<database>.json and the matching .sql files.
 * Differences that succeed are saved even if others fail; then throws an Error
 * whose `errors` lists each failure as { difference, error }.
 */
export const acceptCurrentIntoTemplate = async (connection, templateDir, database, differences) => {
    assertOutsidePackage(templateDir);
    const dbDir = path.join(templateDir, database);
    const jsonPath = path.join(dbDir, `${database}.json`);
    const template = JSON.parse(await fs.readFile(jsonPath, 'utf-8'));
    template.tables = template.tables || {};
    const syncOptions = await loadSyncOptions(templateDir);
    // Kept procedures, views and triggers get the definer option, like a dump
    const current = applyDefinerOption(await getDatabaseStructure(connection, database, 'compare', { output: templateDir }), syncOptions.definer);

    // relative path -> new file content, or null to delete the file
    const files = new Map();
    const errors = [];
    for (const diff of differences) {
        try {
            acceptDifference(template, current, diff, { database, syncOptions, files });
        } catch (e) {
            console.error(`Error keeping current value for ${describeDifference(diff)}: ${e.message}`);
            errors.push({ difference: describeDifference(diff), error: e.message });
        }
    }

    if (errors.length < differences.length) {
        if (template.views && Object.keys(template.views).length === 0) delete template.views;
        await fs.writeFile(jsonPath, JSON.stringify(template, null, 4), 'utf-8');
        for (const [relativePath, content] of files) {
            const filePath = path.join(dbDir, relativePath);
            if (content === null) {
                await fs.rm(filePath, { force: true });
            } else {
                await fs.mkdir(path.dirname(filePath), { recursive: true });
                await fs.writeFile(filePath, `${content}\n`, 'utf-8');
            }
        }
    }

    if (errors.length > 0) {
        const error = new Error(`${errors.length} of ${differences.length} difference(s) could not be kept: ${errors.map(e => `${e.difference} (${e.error})`).join('; ')}`);
        error.errors = errors;
        throw error;
    }
}
