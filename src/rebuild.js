import fs from 'fs/promises';
import path from 'path';
import { parseCreateTableSQL } from './parsers.js';
import { normalizedDefault } from './differences.js';
import { loadSyncOptions, getTableOptions, applyAutoIncrementOption } from './options.js';
import { assertOutsidePackage } from './paths.js';

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
 * createSQL. Returns { 'db.table': [change, ...] } for tables that would change;
 * only writes the files when write is true.
 */
export const rebuildTemplate = async (dir, { write = false } = {}) => {
    if (write) assertOutsidePackage(dir);
    const syncOptions = await loadSyncOptions(dir);
    const report = {};
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
            if (changes.length === 0) continue;

            report[`${database}.${tableName}`] = changes;
            changed = true;
            table.columns = rebuilt.columns;
            table.indexes = rebuilt.indexes;
            table.constraints = rebuilt.constraints;
            if (createSQL !== table.createSQL) {
                table.createSQL = createSQL;
                const sqlPath = path.join(dir, database, 'tables', `${tableName}.sql`);
                if (write && await fs.stat(sqlPath).catch(() => false)) {
                    await fs.writeFile(sqlPath, `${createSQL}\n`, 'utf-8');
                }
            }
        }

        if (changed && write) {
            await fs.writeFile(jsonPath, JSON.stringify(structure, null, 4), 'utf-8');
        }
    }
    return report;
}
