import { logger } from './loggers.js'; // Import the logger
import { normalizeSQLDefinition, normalizeColumnType } from './normalizers.js';
import { parseCreateTableSQL } from './parsers.js';
import { applyAutoIncrementOption, removeAutoIncrementCounter } from './options.js';

// Column attributes that aren't compared but are needed to rebuild a column
// exactly; null means the template's column doesn't have it.
const COLUMN_DETAILS = ['OnUpdate', 'Charset', 'Collate', 'Comment', 'Generated'];

// A nullable column with no default defaults to NULL, and MySQL doesn't print
// DEFAULT NULL for TEXT/BLOB columns, so treat both forms as the same
export const normalizedDefault = (field) => field.Default === undefined && !field.NotNull ? 'NULL' : field.Default;

const isPrimaryIndex = (index) => !!index.Primary || index.Name === 'PRIMARY';

// Compare index columns ignoring order and prefix lengths: `col` and `col`(255) index the same column
const indexKey = (index) => index.ColumnName.map(col => col.replace(/\(\d+\)$/, '')).sort().join(', ');

/**
 * The template table as its createSQL describes it. The stored columns and
 * indexes arrays were derived from createSQL by whichever parser version wrote
 * the dump, and older versions cut some values short ('System Generated' as
 * System, enum(...) as enum). Re-parsing compares both sides with the same
 * parser. The stored arrays are used only when there's no createSQL.
 */
const parseExpectedTable = (tableName, contents) => {
    if (!contents.createSQL) return contents;
    try {
        const parsed = parseCreateTableSQL(contents.createSQL);
        if (!parsed) return contents;
        const columns = parsed.columns.map(column => {
            const withDetails = { ...column };
            for (const key of COLUMN_DETAILS) {
                if (withDetails[key] === undefined) withDetails[key] = null;
            }
            return withDetails;
        });
        return { ...contents, columns, indexes: parsed.indexes };
    } catch (e) {
        logger(`Could not re-parse createSQL for table ${tableName}, using stored structure`, e.message);
        return contents;
    }
}

/**
 * @param getTableOptions  tableName => that table's sync options ({ autoIncrement, rows, ... })
 */
export const findDifferences = (expected, current, getTableOptions = () => ({})) => {
    const differences = [];

    // Detect extra tables
    if (!current.tables) throw new Error('No tables found in current');
    for (const tableName of Object.keys(current.tables)) {
        if (!expected.tables[tableName]) {
            differences.push({ type: 'extra_table', tableName });
        }
    }

    // Compare tables and fields
    if (!expected.tables) throw new Error('No tables found in expected');
    for (const [tableName, storedContents] of Object.entries(expected.tables)) {
        //check if craete table matches from json, if so, we dont need to compare indexes, triggers, or fields
        const contents = parseExpectedTable(tableName, storedContents);
        const { columns, indexes, triggers, createSQL, name, engine, charset, collate } = contents;


        if (!current.tables[tableName]) {
            logger('missing_table', contents);
            differences.push({ type: 'missing_table', tableName, createSQL: applyAutoIncrementOption(contents.createSQL, getTableOptions(tableName).autoIncrement) });
            continue;
        }
        try {
            //verify triggers
            logger('Verifying triggers for table', tableName);
            for (const trigger of triggers) {
                const currentTrigger = current.tables[tableName].triggers.find(t => t.Name === trigger.Name);
                if (!currentTrigger) {
                    logger('Missing trigger', trigger);
                    differences.push({ type: 'missing_trigger', tableName, trigger });
                } else {
                    // Compare additional properties if needed
                    // Compared like procedures: runs of whitespace count as one space
                    if (trigger.Definition !== undefined && normalizeSQLDefinition(currentTrigger.Definition ?? '') !== normalizeSQLDefinition(trigger.Definition)) {
                        logger('Mismatched trigger', { expected: trigger, current: currentTrigger });
                        differences.push({ type: 'mismatched_trigger', tableName, trigger, currentTrigger });
                    }
                }
            }
            for (const trigger of current.tables[tableName].triggers) {
                if (!triggers.some(t => t.Name === trigger.Name)) {
                    logger('Extra trigger', trigger);
                    differences.push({ type: 'extra_trigger', tableName, trigger });
                }
            }
        } catch (e) {
            logger(`Error verifying triggers for table ${tableName}`, e);
        }

        const createTableSql = current.tables[tableName].createSQL;
        // The AUTO_INCREMENT=N counter changes with every insert, so it isn't part of the structure
        if (createTableSql && contents.createSQL && removeAutoIncrementCounter(createTableSql) === removeAutoIncrementCounter(contents.createSQL)) {
            logger(`Table ${tableName} createSQL matches from json, skipping indexes, triggers, and fields`);
            continue;
        } else {
            logger(`Table ${tableName} createSQL does not match from json, comparing indexes, triggers, and fields`);
            logger(createTableSql);
            logger(contents.createSQL);
        }


        const currentFieldNames = current.tables[tableName].columns.map(f => f.Field);
        const expectedFieldNames = columns.map(f => f.Field);

        logger('Detecting missing fields for table', tableName);
        // // Detect missing fields
        // for (const field of columns) {
        //     if (!currentFieldNames.includes(field.Field)) {
        //         differences.push({ type: 'missing_field', tableName, field });
        //     }
        // }

        logger('Detecting extra fields for table', tableName);
        // Detect extra fields
        for (const field of current.tables[tableName].columns) {
            if (!expectedFieldNames.includes(field.Field)) {
                differences.push({ type: 'extra_field', tableName, field });
            }
        }


        // verify Type Null and Default
        logger('Verifying Type Null and Default for table', tableName);
        for (const field of columns) {

            const currentField = current.tables[tableName].columns.find(f => f.Field === field.Field);
            if (!currentField) {
                logger('Current field not found for', field.Field, 'in table', tableName);
                differences.push({ type: 'missing_field', tableName, field });
                continue;
            }
            if (!!field.NotNull !== !!currentField.NotNull) {
                differences.push({ type: 'mismatched_field', info: "Null", tableName, field, currentField });
            }
            if (normalizedDefault(field) !== normalizedDefault(currentField)) {
                differences.push({ type: 'mismatched_field', info: "Default", tableName, field, currentField });
            }
            if (field.Type !== currentField.Type) {
                // int(11) in 5.7 is int in 8.0, year(4) is year, utf8 is utf8mb3: formatting, not structure
                if (normalizeColumnType(field.Type) === normalizeColumnType(currentField.Type)) continue;
                if (field.Type == 'varchar' && currentField.Type.startsWith('varchar(')) continue; // varchar(255) is the default for varchar and used on older versions of mysql
                differences.push({ type: 'mismatched_field', info: "Type", tableName, field, currentField });
            }
        }

        // verify indexes
        logger('Verifying indexes for table', tableName);
        for (const index of indexes) {
            // Check if the current index matches the expected index structure, preferring the same name
            const sameColumns = current.tables[tableName].indexes.filter(i => indexKey(i) === indexKey(index));
            const currentIndex = sameColumns.find(i => i.Name === index.Name) ?? sameColumns[0];
            if (!currentIndex) {
                logger('Missing index', index);
                differences.push({ type: 'missing_index', tableName, indexName: index.Name, index });
            } else {
                // If needed, you can add further checks for uniqueness or other properties here
                if (currentIndex.Name == index.Name) {
                    if (!!currentIndex.Unique !== !!index.Unique) {
                        differences.push({ type: 'mismatched_index', from: 'unique', tableName, indexName: index.Name, index });
                    } else if (isPrimaryIndex(currentIndex) !== isPrimaryIndex(index)) {
                        differences.push({ type: 'mismatched_index', from: 'primary', tableName, indexName: index.Name, index });
                    }
                }
            }
        }

        for (const index of current.tables[tableName].indexes) {
            logger('Checking index', index);
            let indexFound = false

            // Compare sorted copies; sorting ColumnName in place would reorder composite index columns
            if (!indexes.some(i => indexKey(i) === indexKey(index))) {
                differences.push({ type: 'extra_index', tableName, indexName: index.Name, index });
            }
        }


    }




    // Compare stored procedures
    if (!expected.procedures) {
        console.log('No procedures found in expected');
    } else {
        for (const [position, contents] of Object.entries(expected.procedures)) {
            let procName = contents.Name;
            let currentProc = current.procedures.find(p => p.Name === procName);
            if (!currentProc) {
                console.log('missing_procedure', contents);
                differences.push({ type: 'missing_procedure', ...contents });
                continue;
            }


            // Check if the procedure definition matches
            if (currentProc.Definition !== contents.Definition) {
                const normalizedCurrentDef = normalizeSQLDefinition(currentProc.Definition);
                const normalizedNewDef = normalizeSQLDefinition(contents.Definition);

                if (normalizedCurrentDef !== normalizedNewDef) {
                    // currentDefinition lets the difference be shown side by side with the template's
                    differences.push({ type: 'mismatched_procedure', ...contents, currentDefinition: currentProc.Definition });
                }
            }
        }
    }

    // Compare views
    if (expected.views || current.views) {
        // Handle missing views (when expected has views but current doesn't have them)
        if (expected.views && !current.views) {
            for (const [viewName, expectedDefinition] of Object.entries(expected.views)) {
                differences.push({ type: 'missing_view', viewName, definition: expectedDefinition });
            }
        }
        // Handle extra views (when current has views but expected doesn't have them)
        else if (current.views && !expected.views) {
            for (const viewName of Object.keys(current.views)) {
                differences.push({ type: 'extra_view', viewName });
            }
        }
        // Compare views when both exist
        else if (expected.views && current.views) {
            // Check for missing and mismatched views
            for (const [viewName, expectedDefinition] of Object.entries(expected.views)) {
                if (!current.views[viewName]) {
                    differences.push({ type: 'missing_view', viewName, definition: expectedDefinition });
                } else if (normalizeSQLDefinition(current.views[viewName]) !== normalizeSQLDefinition(expectedDefinition)) {
                    differences.push({
                        type: 'mismatched_view',
                        viewName,
                        definition: expectedDefinition,
                        current: current.views[viewName]
                    });
                }
            }

            // Check for extra views
            for (const viewName of Object.keys(current.views)) {
                if (!expected.views[viewName]) {
                    differences.push({ type: 'extra_view', viewName });
                }
            }
        }
    }

    return differences;
}