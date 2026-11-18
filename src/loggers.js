let isVerbose = false; // Global variable to manage verbosity

export const setVerbose = (verbose) => {
    isVerbose = verbose; // Function to set the verbosity level
};

export const logger = (...args) => {
    if (isVerbose) {
        console.log(...args); // Log all arguments if verbose is enabled
    }
};

const show = value => value === undefined || value === null ? 'none' : JSON.stringify(value);

// One clause per changed attribute, using the values the comparison used.
// Differences saved before `comparison` existed fall back to the raw columns.
const fieldChanges = (diff) => {
    const changes = diff.changes?.length ? diff.changes : [diff.info].filter(Boolean);
    return changes.map(change => {
        const compared = diff.comparison?.[change];
        if (compared) return `${change} is ${show(compared.current)}, expected ${show(compared.expected)}`;
        const property = change === 'Null' ? 'NotNull' : change;
        return `${change} is ${show(diff.currentField?.[property])}, expected ${show(diff.field?.[property])}`;
    }).join('; ');
};

// Name every compared index property that differs (columns, unique, type, visibility).
const indexProperties = index => index && {
    columns: `(${(index.ColumnName || []).join(', ')})`,
    unique: !!index.Unique || !!index.Primary || index.Name === 'PRIMARY',
    type: index.Type || 'BTREE',
    visible: index.Visible !== false,
};
const indexChanges = (diff) => {
    const expected = indexProperties(diff.index);
    const current = indexProperties(diff.currentIndex);
    if (!current) return `is mismatched, expected ${expected.columns}`;
    const changed = Object.keys(expected).filter(key => expected[key] !== current[key]);
    return (changed.length ? changed : ['columns']).map(key => `${key} is ${show(current[key])}, expected ${show(expected[key])}`).join('; ');
};

const optionChanges = (diff) => Object.entries(diff.options || {})
    .map(([key, value]) => `${key} is ${show(diff.currentOptions?.[key])}, expected ${show(value)}`).join('; ');

const describe = (diff) => {
    const table = diff.tableName;
    switch (diff.type) {
        case 'missing_database': return [diff.database, `Database ${diff.database} is missing`, 'Database is missing'];
        case 'missing_table': return [table, `Table ${table} is missing`, 'Table is missing'];
        case 'extra_table': return [table, `Table ${table} is extra`, 'Table is extra'];
        case 'mismatched_table_options': return [table, `Table ${table} options: ${optionChanges(diff)}`, 'Table options are mismatched'];
        case 'missing_field': return [table, `Field ${diff.field.Field} is missing`, 'Field is missing'];
        case 'extra_field': return [table, `Field ${diff.field.Field} is extra`, 'Field is extra'];
        case 'mismatched_field': return [table, `Field ${diff.field.Field} ${fieldChanges(diff)}`, 'Field is mismatched'];
        case 'missing_index': return [table, `Index ${diff.index.Name} is missing`, 'Index is missing'];
        case 'extra_index': return [table, `Index ${diff.index.Name} is extra`, 'Index is extra'];
        case 'mismatched_index': return [table, `Index ${diff.index.Name} ${indexChanges(diff)}`, 'Index is mismatched'];
        case 'missing_constraint': return [table, `Foreign key ${diff.constraintName} is missing`, 'Foreign key is missing'];
        case 'extra_constraint': return [table, `Foreign key ${diff.constraintName} is extra`, 'Foreign key is extra'];
        case 'mismatched_constraint': return [table, `Foreign key ${diff.constraintName} is mismatched`, 'Foreign key is mismatched'];
        case 'missing_trigger': return [table, `Trigger ${diff.trigger.Name} is missing`, 'Trigger is missing'];
        case 'extra_trigger': return [table, `Trigger ${diff.trigger.Name} is extra`, 'Trigger is extra'];
        case 'mismatched_trigger': return [table, `Trigger ${diff.trigger.Name} is mismatched`, 'Trigger is mismatched'];
        case 'missing_procedure': return [diff.Name, `Procedure ${diff.Name} is missing`, 'Procedure is missing'];
        case 'mismatched_procedure': return [diff.Name, `Procedure ${diff.Name} is mismatched`, 'Procedure is mismatched'];
        case 'missing_view': return [diff.viewName, `View ${diff.viewName} is missing`, 'View is missing'];
        case 'extra_view': return [diff.viewName, `View ${diff.viewName} is extra`, 'View is extra'];
        case 'mismatched_view': return [diff.viewName, `View ${diff.viewName} is mismatched`, 'View is mismatched'];
        case 'missing_row': return [table, `Row ${JSON.stringify(diff.key)} is missing`, 'Row is missing'];
        default: return [table || diff.Name || diff.viewName || '', `Unhandled difference type: ${diff.type}`, ''];
    }
};

/** A readable row for one difference: { Type, Name, Details, Action }. */
export const formatDifference = (diff) => {
    const [Name, Details, Action] = describe(diff);
    return { Type: diff.type, Name: Name ?? '', Details, Action };
};

export const logDifferences = (differences, database, dryRun) => {
    const formattedDifferences = differences.map(formatDifference);
    if (formattedDifferences.length > 0) {
        logger(dryRun ? `Dry Run: Differences for database ${database}:` : `Differences applied for database ${database}:`);
        console.table(formattedDifferences);
    } else {
        logger(dryRun ? `Dry Run: No differences found. Database: ${database}` : `No differences found. Database: ${database}`);
    }
}
