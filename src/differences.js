import { normalizeSQLDefinition, normalizeServerExpression, normalizeViewDefinition, normalizeColumnType, normalizeVersionFormatting, normalizeTriggerDefinition } from './normalizers.js';
import { parseCreateTableSQL, splitTableForeignKeys } from './parsers.js';
import { applyAutoIncrementOption } from './options.js';
import { adaptSQLForServer, templateDefaultCollations, pinTemplateCollations, isLegacyTemplate } from './versions.js';

const COLUMN_DETAILS = ['OnUpdate', 'Charset', 'Collate', 'Comment', 'Generated'];
export const normalizedDefault = field => field.Default === undefined && !field.NotNull ? 'NULL' : field.Default;
// An expression default (8.0.13+) is SQL: compare it the way other SQL is compared.
const comparableDefault = field => {
    const value = normalizedDefault(field);
    return !field.DefaultQuoted && typeof value === 'string' && value.startsWith('(') ? normalizeServerExpression(value) : value;
};
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
    // 5.7 accepts INVISIBLE (via a compatibility rewrite) and DESC key parts but
    // stores every index visible and ascending. Compare what 5.7 can hold, or
    // the difference could never be repaired.
    const before80 = Number(String(serverVersion).split('.')[0]) < 8;
    const indexes = parsed.indexes.map(index => {
        // InnoDB and MyISAM only build BTREE indexes: 5.7 prints a requested
        // USING HASH, 8.0 omits it. It is not a difference on those engines.
        if (index.Type === 'HASH' && /^(?:InnoDB|MyISAM)$/i.test(parsed.engine || '')) index = { ...index, Type: undefined };
        if (!before80) return index;
        const compatible = { ...index, ColumnName: index.ColumnName.map(part => part.startsWith('(') ? part : part.replace(/\s+DESC$/i, '')) };
        if (compatible.Visible === false) delete compatible.Visible;
        return compatible;
    });
    return { ...contents, ...parsed, columns, indexes, triggers: contents.triggers || [] };
};
const textColumn = field => /^(?:var)?char\b|^(?:tiny|medium|long)?text\b|^enum\b|^set\b/i.test(field.Type);
const charsetOf = (field, table) => normalizeVersionFormatting(field.Charset || field.Collate?.split('_')[0] || table.charset || null);
const collationOf = (field, table, defaults) => normalizeVersionFormatting(field.Collate
    || (!field.Charset ? table.collate : null)
    || defaults[charsetOf(field, table)] || null);
const normalizedExpression = expression => expression ? normalizeServerExpression(expression) : null;

// The common columns that have to move for the live order to match the template:
// those outside a longest common subsequence of the two orders. Moving one column
// therefore reports that column, not every column it was moved past.
const movedColumns = (expected, current) => {
    const rows = expected.length;
    const cols = current.length;
    const lcs = Array.from({ length: rows + 1 }, () => new Uint32Array(cols + 1));
    for (let i = rows - 1; i >= 0; i--) for (let j = cols - 1; j >= 0; j--) {
        lcs[i][j] = expected[i] === current[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
    const kept = new Set();
    for (let i = 0, j = 0; i < rows && j < cols;) {
        if (expected[i] === current[j]) { kept.add(expected[i]); i++; j++; }
        else if (lcs[i + 1][j] >= lcs[i][j + 1]) i++;
        else j++;
    }
    return new Set(expected.filter(name => !kept.has(name)));
};

// Readable expected/current values for each reported change, so a report shows
// the values that were actually compared (effective charset, NULL/NOT NULL, the
// preceding column) rather than raw parser properties that may be absent.
const shown = value => value === undefined || value === null || value === '' ? null : value;
const placement = after => after === null ? 'FIRST' : `AFTER ${after}`;

/**
 * The fourth argument supplies serverVersion for 8.0 -> 5.7 compatibility, the
 * live server's defaultCollations, and templateVersion (the MySQL version the
 * template was dumped from), which decides what an implicit collation in the
 * template means.
 */
export const findDifferences = (expected, current, getTableOptions = () => ({}), { serverVersion, database, defaultCollations = {}, templateVersion } = {}) => {
    const normalizeDefaults = collations => Object.fromEntries(Object.entries(collations).map(([charset, collation]) => [normalizeVersionFormatting(charset), normalizeVersionFormatting(collation)]));
    const defaults = normalizeDefaults(defaultCollations);
    // What the template's implicit collations meant on the server it came from.
    const templateDefaults = normalizeDefaults(templateDefaultCollations(templateVersion, defaultCollations));
    const legacyTemplate = isLegacyTemplate(templateVersion);
    // 5.7 stores TRUE/FALSE as 1/0, losing the distinction; only when comparing a
    // template and a server of different major versions are they the same.
    const major = version => String(version ?? '').match(/^(\d+)\./)?.[1];
    const booleans = !!major(templateVersion) && !!major(serverVersion) && major(templateVersion) !== major(serverVersion);
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
            const createSQL = pinTemplateCollations(applyAutoIncrementOption(stored.createSQL, getTableOptions(tableName).autoIncrement), templateVersion, serverVersion);
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
            else if (trigger.Definition !== undefined && normalizeTriggerDefinition(currentTrigger.Definition ?? '') !== normalizeTriggerDefinition(adaptSQLForServer(trigger.Definition, serverVersion))) differences.push({ type: 'mismatched_trigger', tableName, trigger, currentTrigger });
        }
        for (const trigger of live.triggers) {
            if (!triggers.some(t => t.Name === trigger.Name)) differences.push({ type: 'extra_trigger', tableName, trigger });
        }
        const tableOptions = {};
        // A legacy (5.7) template's implicit table collation is its charset's 5.7 default.
        const expectedOptions = { ...contents };
        if (legacyTemplate && !contents.collate && contents.charset) expectedOptions.collate = templateDefaults[normalizeVersionFormatting(contents.charset)] || null;
        for (const key of ['engine', 'charset', 'collate']) {
            if (expectedOptions[key] && normalizeVersionFormatting(expectedOptions[key]).toLowerCase() !== normalizeVersionFormatting(live[key] || (key === 'collate' ? defaults[normalizeVersionFormatting(live.charset)] : '') || '').toLowerCase()) tableOptions[key] = expectedOptions[key];
        }
        if (Object.keys(tableOptions).length) {
            if (tableOptions.collate && contents.charset) tableOptions.charset = contents.charset;
            differences.push({ type: 'mismatched_table_options', tableName, options: tableOptions, currentOptions: { engine: live.engine, charset: live.charset, collate: live.collate } });
        }
        const expectedNames = columns.map(field => field.Field);
        const currentNames = live.columns.map(field => field.Field);
        const moved = movedColumns(expectedNames.filter(name => currentNames.includes(name)), currentNames.filter(name => expectedNames.includes(name)));
        for (const field of live.columns) {
            if (!expectedNames.includes(field.Field)) differences.push({ type: 'extra_field', tableName, field });
        }
        for (const [position, field] of columns.entries()) {
            const after = position ? columns[position - 1].Field : null;
            const currentField = live.columns.find(f => f.Field === field.Field);
            if (!currentField) {
                // Like a CHANGE, an ADD must state a legacy template's implicit collation.
                const added = legacyTemplate && textColumn(field) && !field.Collate && charsetOf(field, expectedOptions)
                    ? { ...field, Charset: charsetOf(field, expectedOptions), Collate: collationOf(field, expectedOptions, templateDefaults) } : field;
                differences.push({ type: 'missing_field', tableName, field: added, after });
                continue;
            }
            const changed = [];
            const comparison = {};
            const change = (name, expectedValue, currentValue) => {
                changed.push(name);
                comparison[name] = { expected: shown(expectedValue), current: shown(currentValue) };
            };
            const nullability = column => column.NotNull ? 'NOT NULL' : 'NULL';
            const defaultText = column => column.DefaultQuoted ? `'${column.Default}'` : normalizedDefault(column);
            if (!!field.NotNull !== !!currentField.NotNull) change('Null', nullability(field), nullability(currentField));
            if (comparableDefault(field) !== comparableDefault(currentField) || !!field.DefaultQuoted !== !!currentField.DefaultQuoted) change('Default', defaultText(field), defaultText(currentField));
            if (normalizeColumnType(field.Type) !== normalizeColumnType(currentField.Type) && !(field.Type === 'varchar' && currentField.Type.startsWith('varchar('))) change('Type', field.Type, currentField.Type);
            if (!!field.AutoIncrement !== !!currentField.AutoIncrement) change('AutoIncrement', !!field.AutoIncrement, !!currentField.AutoIncrement);
            if (normalizedExpression(field.OnUpdate) !== normalizedExpression(currentField.OnUpdate)) change('OnUpdate', field.OnUpdate, currentField.OnUpdate);
            if (normalizedExpression(field.Generated) !== normalizedExpression(currentField.Generated)) change('Generated', field.Generated, currentField.Generated);
            if ((field.Comment || '') !== (currentField.Comment || '')) change('Comment', field.Comment, currentField.Comment);
            if (textColumn(field)) {
                const charset = charsetOf(field, contents);
                const collation = collationOf(field, expectedOptions, templateDefaults);
                if (charset && charset !== charsetOf(currentField, live)) change('Charset', charset, charsetOf(currentField, live));
                if (collation && collation !== collationOf(currentField, live, defaults)) change('Collate', collation, collationOf(currentField, live, defaults));
            }
            if (moved.has(field.Field)) {
                const livePosition = live.columns.indexOf(currentField);
                change('Position', placement(after), placement(livePosition ? live.columns[livePosition - 1].Field : null));
            }
            if (changed.length) {
                // Restate effective defaults so CHANGE cannot inherit a drifted charset.
                const desired = { ...field };
                if (textColumn(field) && charsetOf(field, contents)) desired.Charset = charsetOf(field, contents);
                if (textColumn(field) && collationOf(field, expectedOptions, templateDefaults)) desired.Collate = collationOf(field, expectedOptions, templateDefaults);
                differences.push({ type: 'mismatched_field', info: changed[0], changes: changed, comparison, tableName, field: desired, currentField, after });
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
        else if (normalizeViewDefinition(current.views[viewName], { booleans }) !== normalizeViewDefinition(adaptSQLForServer(definition, serverVersion), { booleans })) differences.push({ type: 'mismatched_view', viewName, definition, current: current.views[viewName] });
    }
    for (const viewName of Object.keys(current.views || {})) {
        if (!expected.views?.[viewName]) differences.push({ type: 'extra_view', viewName });
    }
    return differences;
};
