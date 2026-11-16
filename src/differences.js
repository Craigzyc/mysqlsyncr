import { normalizeSQLDefinition, normalizeColumnType, normalizeVersionFormatting } from './normalizers.js';
import { parseCreateTableSQL, splitTableForeignKeys } from './parsers.js';
import { applyAutoIncrementOption } from './options.js';
import { adaptSQLForServer } from './versions.js';

const COLUMN_DETAILS = ['OnUpdate', 'Charset', 'Collate', 'Comment', 'Generated'];
export const normalizedDefault = field => field.Default === undefined && !field.NotNull ? 'NULL' : field.Default;
const isPrimaryIndex = index => !!index.Primary || index.Name === 'PRIMARY';
const indexKey = index => JSON.stringify([index.ColumnName, !!index.Unique || isPrimaryIndex(index), isPrimaryIndex(index), index.Type || 'BTREE', index.Visible !== false]);
const normalizeAction = action => !action || action === 'RESTRICT' ? 'NO ACTION' : action;
const constraintKey = (constraint, database) => JSON.stringify([
    constraint.ColumnName,
    constraint.References.Database === database ? '' : constraint.References.Database || '',
    constraint.References.Table, constraint.References.Columns || [].concat(constraint.References.Column),
    normalizeAction(constraint.OnDelete), normalizeAction(constraint.OnUpdate)
]);

// Re-parse authoritative CREATE SQL instead of trusting stale arrays in old dumps.
const parseTable = (contents, serverVersion) => {
    if (!contents.createSQL) return { columns: [], indexes: [], constraints: [], triggers: [], ...contents };
    const parsed = parseCreateTableSQL(adaptSQLForServer(contents.createSQL, serverVersion));
    const columns = parsed.columns.map(column => {
        const details = { ...column };
        for (const key of COLUMN_DETAILS) if (details[key] === undefined) details[key] = null;
        return details;
    });
    const indexes = parsed.indexes.map(index => {
        if (Number(String(serverVersion).split('.')[0]) < 8 && index.Visible === false) {
            const compatible = { ...index };
            delete compatible.Visible;
            return compatible;
        }
        return index;
    });
    return { ...contents, ...parsed, columns, indexes, triggers: contents.triggers || [] };
};
const textColumn = field => /^(?:var)?char\b|^(?:tiny|medium|long)?text\b|^enum\b|^set\b/i.test(field.Type);
const charsetOf = (field, table) => normalizeVersionFormatting(field.Charset || field.Collate?.split('_')[0] || table.charset || null);
const collationOf = (field, table, defaults) => normalizeVersionFormatting(field.Collate
    || (!field.Charset ? table.collate : null)
    || defaults[charsetOf(field, table)] || null);
const normalizedExpression = expression => expression ? normalizeSQLDefinition(expression) : null;

/** The fourth argument supplies serverVersion for 8.0 -> 5.7 compatibility. */
export const findDifferences = (expected, current, getTableOptions = () => ({}), { serverVersion, database, defaultCollations = {} } = {}) => {
    const defaults = Object.fromEntries(Object.entries(defaultCollations).map(([charset, collation]) => [normalizeVersionFormatting(charset), normalizeVersionFormatting(collation)]));
    if (!expected.tables) throw new Error('No tables found in expected');
    if (!current.tables) throw new Error('No tables found in current');
    const differences = [];
    for (const tableName of Object.keys(current.tables)) {
        if (!expected.tables[tableName]) {
            // Remove references owned by tables being dropped before dropping
            // any table. This also handles cycles without disabling FK checks.
            for (const constraint of parseTable(current.tables[tableName]).constraints) {
                differences.push({ type: 'extra_constraint', tableName, constraintName: constraint.Name, constraint });
            }
            differences.push({ type: 'extra_table', tableName });
        }
    }
    for (const [tableName, stored] of Object.entries(expected.tables)) {
        const contents = parseTable(stored, serverVersion);
        const { columns, indexes, constraints, triggers } = contents;
        if (!current.tables[tableName]) {
            const createSQL = applyAutoIncrementOption(stored.createSQL, getTableOptions(tableName).autoIncrement);
            const plan = splitTableForeignKeys(createSQL);
            differences.push({ type: 'missing_table', tableName, createSQL: plan.createSQL });
            // Add references after all tables exist, including cycles and other
            // databases. MySQL still validates existing rows when adding the FK.
            for (const constraint of plan.constraints) differences.push({ type: 'missing_constraint', tableName, constraintName: constraint.Name, constraint });
            for (const trigger of triggers) differences.push({ type: 'missing_trigger', tableName, trigger });
            continue;
        }
        const live = parseTable(current.tables[tableName]);
        for (const trigger of triggers) {
            const currentTrigger = live.triggers.find(t => t.Name === trigger.Name);
            if (!currentTrigger) differences.push({ type: 'missing_trigger', tableName, trigger });
            else if (trigger.Definition !== undefined && normalizeSQLDefinition(currentTrigger.Definition ?? '') !== normalizeSQLDefinition(adaptSQLForServer(trigger.Definition, serverVersion))) differences.push({ type: 'mismatched_trigger', tableName, trigger, currentTrigger });
        }
        for (const trigger of live.triggers) {
            if (!triggers.some(t => t.Name === trigger.Name)) differences.push({ type: 'extra_trigger', tableName, trigger });
        }
        const tableOptions = {};
        for (const key of ['engine', 'charset', 'collate']) {
            if (contents[key] && normalizeVersionFormatting(contents[key]).toLowerCase() !== normalizeVersionFormatting(live[key] || (key === 'collate' ? defaults[normalizeVersionFormatting(live.charset)] : '') || '').toLowerCase()) tableOptions[key] = contents[key];
        }
        if (Object.keys(tableOptions).length) {
            if (tableOptions.collate && contents.charset) tableOptions.charset = contents.charset;
            differences.push({ type: 'mismatched_table_options', tableName, options: tableOptions, currentOptions: { engine: live.engine, charset: live.charset, collate: live.collate } });
        }
        const expectedNames = columns.map(field => field.Field);
        const currentNames = live.columns.map(field => field.Field);
        const expectedCommon = expectedNames.filter(name => currentNames.includes(name));
        const currentCommon = currentNames.filter(name => expectedNames.includes(name));
        for (const field of live.columns) {
            if (!expectedNames.includes(field.Field)) differences.push({ type: 'extra_field', tableName, field });
        }
        for (const [position, field] of columns.entries()) {
            const after = position ? columns[position - 1].Field : null;
            const currentField = live.columns.find(f => f.Field === field.Field);
            if (!currentField) {
                differences.push({ type: 'missing_field', tableName, field, after });
                continue;
            }
            const changed = [];
            if (!!field.NotNull !== !!currentField.NotNull) changed.push('Null');
            if (normalizedDefault(field) !== normalizedDefault(currentField) || !!field.DefaultQuoted !== !!currentField.DefaultQuoted) changed.push('Default');
            if (normalizeColumnType(field.Type) !== normalizeColumnType(currentField.Type) && !(field.Type === 'varchar' && currentField.Type.startsWith('varchar('))) changed.push('Type');
            if (!!field.AutoIncrement !== !!currentField.AutoIncrement) changed.push('AutoIncrement');
            if (normalizedExpression(field.OnUpdate) !== normalizedExpression(currentField.OnUpdate)) changed.push('OnUpdate');
            if (normalizedExpression(field.Generated) !== normalizedExpression(currentField.Generated)) changed.push('Generated');
            if ((field.Comment || '') !== (currentField.Comment || '')) changed.push('Comment');
            if (textColumn(field)) {
                if (charsetOf(field, contents) && charsetOf(field, contents) !== charsetOf(currentField, live)) changed.push('Charset');
                if (collationOf(field, contents, defaults) && collationOf(field, contents, defaults) !== collationOf(currentField, live, defaults)) changed.push('Collate');
            }
            if (expectedCommon.indexOf(field.Field) !== currentCommon.indexOf(field.Field)) changed.push('Position');
            if (changed.length) {
                // Restate effective defaults so CHANGE cannot inherit a drifted charset.
                const desired = { ...field };
                if (textColumn(field) && charsetOf(field, contents)) desired.Charset = charsetOf(field, contents);
                if (textColumn(field) && collationOf(field, contents, defaults)) desired.Collate = collationOf(field, contents, defaults);
                differences.push({ type: 'mismatched_field', info: changed[0], changes: changed, tableName, field: desired, currentField, after });
            }
        }
        const matchedIndexes = new Set();
        for (const index of indexes) {
            const sameName = live.indexes.find(i => i.Name === index.Name);
            const equivalent = live.indexes.find(i => !matchedIndexes.has(i) && indexKey(i) === indexKey(index));
            const currentIndex = sameName || equivalent;
            if (!currentIndex) differences.push({ type: 'missing_index', tableName, indexName: index.Name, index });
            else {
                matchedIndexes.add(currentIndex);
                if (indexKey(currentIndex) !== indexKey(index)) differences.push({ type: 'mismatched_index', tableName, indexName: index.Name, index, currentIndex });
            }
        }
        for (const index of live.indexes) {
            if (!matchedIndexes.has(index)) differences.push({ type: 'extra_index', tableName, indexName: index.Name, index });
        }
        for (const constraint of constraints) {
            const currentConstraint = live.constraints.find(c => c.Name === constraint.Name);
            if (!currentConstraint) differences.push({ type: 'missing_constraint', tableName, constraintName: constraint.Name, constraint });
            else if (constraintKey(constraint, database) !== constraintKey(currentConstraint, database)) differences.push({ type: 'mismatched_constraint', tableName, constraintName: constraint.Name, constraint, currentConstraint });
        }
        for (const constraint of live.constraints) {
            if (!constraints.some(c => c.Name === constraint.Name)) differences.push({ type: 'extra_constraint', tableName, constraintName: constraint.Name, constraint });
        }
    }
    for (const procedure of expected.procedures || []) {
        const currentProcedure = (current.procedures || []).find(p => p.Name === procedure.Name);
        if (!currentProcedure) differences.push({ type: 'missing_procedure', ...procedure });
        else if (normalizeSQLDefinition(currentProcedure.Definition) !== normalizeSQLDefinition(adaptSQLForServer(procedure.Definition, serverVersion))) differences.push({ type: 'mismatched_procedure', ...procedure, currentDefinition: currentProcedure.Definition });
    }
    for (const [viewName, definition] of Object.entries(expected.views || {})) {
        if (!current.views?.[viewName]) differences.push({ type: 'missing_view', viewName, definition });
        else if (normalizeSQLDefinition(current.views[viewName]) !== normalizeSQLDefinition(adaptSQLForServer(definition, serverVersion))) differences.push({ type: 'mismatched_view', viewName, definition, current: current.views[viewName] });
    }
    for (const viewName of Object.keys(current.views || {})) {
        if (!expected.views?.[viewName]) differences.push({ type: 'extra_view', viewName });
    }
    return differences;
};
