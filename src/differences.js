import { logger } from './loggers.js'; // Import the logger
import { normalizeSQLDefinition } from './normalizers.js';
import { parseCreateTableSQL } from './parsers.js';

// The `columns` and `indexes` arrays stored in a dump are derived data, produced by
// whichever parser version wrote that dump. `createSQL` is the source of truth, so
// re-parse it and compare both sides with the same parser. Without this an older dump
// reports differences that no DDL can ever resolve - index prefix lengths, Unique
// flags, truncated enum types - because only the live side gets the current parser.
// A column with no DEFAULT clause defaults to NULL, so an explicit `DEFAULT NULL` and no
// clause at all describe the same column. They have to compare equal: SHOW CREATE TABLE
// omits the clause entirely for TEXT and BLOB columns, so a dump that states it produces
// a difference that applying can never resolve - the ALTER succeeds, the server still
// reports the column without it, and the same difference returns on the next compare.
const defaultOf = (column) => (column.Default === undefined || column.Default === null ? 'NULL' : column.Default);

// Index columns compared as a set, without disturbing the declared column order.
const sortedColumns = (index) => [...(index.ColumnName || [])].sort().join(', ');

const parseExpectedTable = (tableName, contents) => {
    if (!contents.createSQL) return contents;
    try {
        const reparsed = parseCreateTableSQL(contents.createSQL);
        if (!reparsed) return contents;
        return { ...contents, columns: reparsed.columns, indexes: reparsed.indexes };
    } catch (e) {
        logger(`Could not re-parse createSQL for table ${tableName}, using stored structure`, e);
        return contents;
    }
};
export const findDifferences = (expected, current) => {
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
            differences.push({ type: 'missing_table', tableName, createSQL: contents.createSQL });
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
                    if (currentTrigger.Event !== trigger.Event || currentTrigger.Statement !== trigger.Statement) {
                        logger('Mismatched trigger', { expected: trigger, current: currentTrigger });
                        differences.push({ type: 'mismatched_trigger', tableName, trigger });
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
        if (createTableSql === contents.createSQL) {
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
            if (field.Null !== currentField.Null) {
                differences.push({ type: 'mismatched_field', info: "Null", tableName, field, currentField });
            }
            if (defaultOf(field) !== defaultOf(currentField)) {
                differences.push({ type: 'mismatched_field', info: "Default", tableName, field, currentField });
            }
            if (field.Type !== currentField.Type) {
                if (field.Type == 'int' && currentField.Type.startsWith('int(')) continue; // int(11) is the default for int and used on older versions of mysql
                if (field.Type == 'smallint' && currentField.Type.startsWith('smallint(')) continue; // smallint(6) is the default for smallint and used on older versions of mysql
                if (field.Type == 'tinyint' && currentField.Type.startsWith('tinyint(')) continue; // tinyint(1) is the default for tinyint and used on older versions of mysql
                if (field.Type == 'varchar' && currentField.Type.startsWith('varchar(')) continue; // varchar(255) is the default for varchar and used on older versions of mysql
                if (field.Type == 'bigint' && currentField.Type.startsWith('bigint(')) continue; // bigint(20) is the default for bigint and used on older versions of mysql
                differences.push({ type: 'mismatched_field', info: "Type", tableName, field, currentField });
            }
        }

        // verify indexes
        logger('Verifying indexes for table', tableName);
        for (const index of indexes) {
            // Check if the current index matches the expected index structure.
            // Sort a copy: Array#sort is in place, and sorting index.ColumnName itself
            // reorders the columns of the index object that gets attached to the
            // difference below, so applying a missing composite index would create it
            // in alphabetical order rather than the order the table declares.
            const currentIndex = current.tables[tableName].indexes.find(i =>
                sortedColumns(i) === sortedColumns(index)
            );
            if (!currentIndex) {
                logger('Missing index', index);
                differences.push({ type: 'missing_index', tableName, indexName: index.Name, index });
            } else {
                // If needed, you can add further checks for uniqueness or other properties here
                if (currentIndex.Name == index.Name) {
                    if (currentIndex.Unique !== index.Unique) {
                        differences.push({ type: 'mismatched_index', from: 'unique', tableName, indexName: index.Name, index });
                    } else if (currentIndex.Primary !== index.Primary) {
                        differences.push({ type: 'mismatched_index', from: 'primary', tableName, indexName: index.Name, index });
                    }
                }
            }
        }

        for (const index of current.tables[tableName].indexes) {
            logger('Checking index', index);
            let indexFound = false

            // Sort the ColumnName array for proper comparison
            const sortedCurrentIndexColumns = sortedColumns(index);
            if (!indexes.some(i => sortedColumns(i) === sortedCurrentIndexColumns)) {
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
                    differences.push({ type: 'mismatched_procedure', ...contents });
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
                } else if (current.views[viewName] !== expectedDefinition) {
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