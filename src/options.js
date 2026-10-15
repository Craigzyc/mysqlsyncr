import fs from 'fs/promises';
import path from 'path';

/**
 * Optional file in the dump/template directory:
 *
 * {
 *   "definer": "root@%",                     // DEFINER for every procedure, view and trigger
 *   "autoIncrement": false,                  // default for every table
 *   "databases": {
 *     "Alerts": {
 *       "AlarmRules": {
 *         "autoIncrement": 1000,             // overrides the default for this table
 *         "rowKey": ["idAlarmRule"],         // columns that identify a row; defaults to the primary key
 *         "rows": [{ "idAlarmRule": 1, "name": "Default" }]
 *       }
 *     }
 *   }
 * }
 *
 * autoIncrement controls the table's AUTO_INCREMENT=N counter in CREATE TABLE
 * (not the AUTO_INCREMENT column attribute):
 *   true   keep the counter as dumped (the default)
 *   false  remove it, so new tables start at 1
 *   N      start new tables at N
 *
 * rows are inserted when no row with the same rowKey values exists; existing rows are never changed.
 *
 * definer replaces the DEFINER of every procedure, view and trigger in the
 * template, so one whose database definer differs is reported and recreated
 * with it. Written as root@%, `root`@`%` or 'root'@'%'.
 */
export const OPTIONS_FILE = 'syncOptions.json';

export const loadSyncOptions = async (dir) => {
    const filePath = path.join(dir, OPTIONS_FILE);
    let content;
    try {
        content = await fs.readFile(filePath, 'utf-8');
    } catch (err) {
        if (err.code === 'ENOENT') return {};
        throw err;
    }
    let options;
    try {
        options = JSON.parse(content);
    } catch (err) {
        throw new Error(`Invalid JSON in ${filePath}: ${err.message}`);
    }
    validateSyncOptions(options, filePath);
    return options;
}

const isValidAutoIncrement = (value) => value === undefined || typeof value === 'boolean' || (Number.isInteger(value) && value > 0);

const validateSyncOptions = (options, filePath) => {
    if (options.definer !== undefined && formatDefiner(options.definer) === null) {
        throw new Error(`${filePath}: definer must look like root@% or \`root\`@\`%\``);
    }
    if (!isValidAutoIncrement(options.autoIncrement)) {
        throw new Error(`${filePath}: autoIncrement must be true, false or a positive integer`);
    }
    for (const [database, tables] of Object.entries(options.databases || {})) {
        for (const [table, tableOptions] of Object.entries(tables || {})) {
            const where = `${filePath}: ${database}.${table}`;
            if (!isValidAutoIncrement(tableOptions.autoIncrement)) {
                throw new Error(`${where}.autoIncrement must be true, false or a positive integer`);
            }
            if (tableOptions.rows !== undefined && (!Array.isArray(tableOptions.rows) || tableOptions.rows.some(row => !row || typeof row !== 'object' || Array.isArray(row)))) {
                throw new Error(`${where}.rows must be an array of objects`);
            }
            if (tableOptions.rowKey !== undefined && (!Array.isArray(tableOptions.rowKey) || tableOptions.rowKey.length === 0)) {
                throw new Error(`${where}.rowKey must be a non-empty array of column names`);
            }
        }
    }
}

export const getTableOptions = (syncOptions, database, table) => ({
    autoIncrement: syncOptions?.autoIncrement ?? true,
    ...syncOptions?.databases?.[database]?.[table]
});

export const removeAutoIncrementCounter = (createSQL) => createSQL.replace(/\s+AUTO_INCREMENT=\d+/i, '');

// Apply a table's autoIncrement option to its CREATE TABLE statement
export const applyAutoIncrementOption = (createSQL, autoIncrement = true) => {
    if (!createSQL || autoIncrement === true) return createSQL;
    const withoutCounter = removeAutoIncrementCounter(createSQL);
    if (autoIncrement === false) return withoutCounter;
    if (/\)\s*ENGINE=\w+/i.test(withoutCounter)) {
        return withoutCounter.replace(/(\)\s*ENGINE=\w+)/i, `$1 AUTO_INCREMENT=${autoIncrement}`);
    }
    return withoutCounter.replace(/\)(\s*;?\s*)$/, `) AUTO_INCREMENT=${autoIncrement}$1`);
}

// root@%, `root`@`%`, 'root'@'%' or DEFINER=... -> `root`@`%`; null if it isn't a user@host
export const formatDefiner = (definer) => {
    if (typeof definer !== 'string') return null;
    const match = definer.trim().replace(/^DEFINER\s*=\s*/i, '')
        .match(/^(?:`([^`]+)`|'([^']+)'|([^@`'\s]+))@(?:`([^`]+)`|'([^']+)'|([^@`'\s]+))$/);
    if (!match) return null;
    const user = match[1] ?? match[2] ?? match[3];
    const host = match[4] ?? match[5] ?? match[6];
    return `\`${user}\`@\`${host}\``;
}

// The DEFINER clause in a CREATE PROCEDURE/VIEW/TRIGGER header
const definerClauseRegex = /DEFINER\s*=\s*(?:`[^`]*`|'[^']*'|[^\s@]+)@(?:`[^`]*`|'[^']*'|[^\s]+)/i;

// Replace the DEFINER in one definition; unchanged when definer isn't set or the definition has none
export const applyDefiner = (definition, definer) => {
    const formatted = definer ? formatDefiner(definer) : null;
    if (!formatted || typeof definition !== 'string') return definition;
    return definition.replace(definerClauseRegex, `DEFINER=${formatted}`);
}

// A copy of a database structure with the definer option applied to its procedures, views and triggers
export const applyDefinerOption = (structure, definer) => {
    if (!definer || !structure) return structure;
    const tables = Object.fromEntries(Object.entries(structure.tables || {}).map(([name, table]) => [name, {
        ...table,
        triggers: (table.triggers || []).map(trigger => ({ ...trigger, Definition: applyDefiner(trigger.Definition, definer) }))
    }]));
    const result = { ...structure, tables };
    if (structure.procedures) {
        result.procedures = structure.procedures.map(procedure => ({ ...procedure, Definition: applyDefiner(procedure.Definition, definer) }));
    }
    if (structure.views) {
        result.views = Object.fromEntries(Object.entries(structure.views).map(([name, view]) => [name, applyDefiner(view, definer)]));
    }
    return result;
}
