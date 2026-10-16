import fs from 'fs/promises';
import path from 'path';
import { parseCreateTableSQL } from './parsers.js';
import { normalizedDefault } from './differences.js';
import { loadSyncOptions, getTableOptions, applyAutoIncrementOption } from './options.js';
import { assertOutsidePackage } from './paths.js';
import { splitSqlFile } from './templateDrift.js';

const describeColumn = (col) => JSON.stringify({ Type: col.Type, NotNull: !!col.NotNull, Default: normalizedDefault(col) });
const describeIndexes = (indexes) => (indexes || [])
    .map(i => `${i.Name}${i.Primary || i.Name === 'PRIMARY' ? ' PRIMARY' : ''}${i.Unique ? ' UNIQUE' : ''} (${i.ColumnName.join(', ')})`)
    .sort();

// What would change in one table's JSON if it were rebuilt from its createSQL
const tableChanges = (table, rebuilt, createSQL) => {
    const changes = [];
    if (createSQL !== table.createSQL) {
        changes.push('createSQL: AUTO_INCREMENT counter changed by the autoIncrement option');
    }
    for (const col of table.columns || []) {
        const rebuiltCol = rebuilt.columns.find(c => c.Field === col.Field);
        if (!rebuiltCol) {
            changes.push(`column ${col.Field}: in the JSON but not in createSQL (removed)`);
        } else if (describeColumn(col) !== describeColumn(rebuiltCol)) {
            changes.push(`column ${col.Field}: JSON ${describeColumn(col)} -> createSQL ${describeColumn(rebuiltCol)}`);
        }
    }
    for (const col of rebuilt.columns) {
        if (!(table.columns || []).some(c => c.Field === col.Field)) {
            changes.push(`column ${col.Field}: in createSQL but not in the JSON (added)`);
        }
    }
    const before = describeIndexes(table.indexes);
    const after = describeIndexes(rebuilt.indexes);
    for (const index of before.filter(i => !after.includes(i))) changes.push(`index ${index}: removed`);
    for (const index of after.filter(i => !before.includes(i))) changes.push(`index ${index}: added`);
    return changes;
}

/**
 * Rebuild each table's columns/indexes/constraints in a template from its
 * createSQL with the current parser, applying the autoIncrement option to the
 * createSQL. Returns { changes, notes }: changes is { 'db.table': [change, ...] }
 * for tables that would change, notes is { 'db.table': note } for things to check
 * by hand. Only writes the files when write is true.
 */
export const rebuildTemplate = async (dir, { write = false } = {}) => {
    if (write) assertOutsidePackage(dir);
    const syncOptions = await loadSyncOptions(dir);
    const report = {};
    const notes = {};
    const entries = await fs.readdir(dir, { withFileTypes: true });

    for (const entry of entries.filter(e => e.isDirectory())) {
        const database = entry.name;
        const jsonPath = path.join(dir, database, `${database}.json`);
        let structure;
        try {
            structure = JSON.parse(await fs.readFile(jsonPath, 'utf-8'));
        } catch (err) {
            if (err.code === 'ENOENT') continue;
            throw new Error(`Could not read ${jsonPath}: ${err.message}`);
        }

        let changed = false;
        for (const [tableName, table] of Object.entries(structure.tables || {})) {
            if (!table.createSQL) continue;
            const createSQL = applyAutoIncrementOption(table.createSQL, getTableOptions(syncOptions, database, tableName).autoIncrement);
            const rebuilt = parseCreateTableSQL(createSQL);
            const changes = tableChanges(table, rebuilt, createSQL);

            // tables/<table>.sql should match createSQL, but it can hold notes or edits made
            // by hand, so only the AUTO_INCREMENT option is applied to it; any other
            // difference is reported, never overwritten
            const sqlPath = path.join(dir, database, 'tables', `${tableName}.sql`);
            const sqlFile = await fs.readFile(sqlPath, 'utf-8').catch(() => null);
            const fixedSqlFile = sqlFile === null ? null : applyAutoIncrementOption(sqlFile, getTableOptions(syncOptions, database, tableName).autoIncrement);
            const sqlCounterChanged = sqlFile !== null && fixedSqlFile !== sqlFile;
            if (sqlCounterChanged) changes.push(`tables/${tableName}.sql: AUTO_INCREMENT counter changed by the autoIncrement option`);
            // Notes written after the statement don't count
            const sameSQL = (a, b) => a.replace(/\r\n/g, '\n').replace(/;?\s*$/, '') === b.replace(/\r\n/g, '\n').replace(/;?\s*$/, '');
            const sqlFileDrifted = fixedSqlFile !== null && !sameSQL(splitSqlFile(fixedSqlFile).statement, createSQL);
            if (changes.length === 0 && !sqlFileDrifted) continue;

            if (changes.length > 0) report[`${database}.${tableName}`] = changes;
            if (sqlFileDrifted) {
                notes[`${database}.${tableName}`] = `tables/${tableName}.sql differs from the createSQL in ${database}.json (left as is; compare uses the JSON). Pick which to keep in the UI.`;
            }
            if (sqlCounterChanged && write) {
                await fs.writeFile(sqlPath, fixedSqlFile, 'utf-8');
            }
            if (changes.length === 0 || changes.every(change => change.startsWith('tables/'))) continue; // the JSON is already right

            changed = true;
            table.columns = rebuilt.columns;
            table.indexes = rebuilt.indexes;
            table.constraints = rebuilt.constraints;
            table.createSQL = createSQL;
        }

        if (changed && write) {
            await fs.writeFile(jsonPath, JSON.stringify(structure, null, 4), 'utf-8');
        }
    }
    return { changes: report, notes };
}
