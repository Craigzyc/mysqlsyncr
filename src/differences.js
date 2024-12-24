import { logger } from './loggers.js'; // Import the logger
import { normalizeSQLDefinition } from './normalizers.js';
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
    for (const [tableName, contents] of Object.entries(expected.tables)) {
        //check if craete table matches from json, if so, we dont need to compare indexes, triggers, or fields
        
        if (!current.tables[tableName]) {
            console.log('missing_table', contents);
            differences.push({ type: 'missing_table', tableName, createSQL: contents.createSQL });
            continue;
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
        const { columns, indexes, triggers, createSQL, name, engine, charset, collate } = contents;


        const currentFieldNames = current.tables[tableName].columns.map(f => f.Field);
        const expectedFieldNames = columns.map(f => f.Field);

        logger('Detecting missing fields for table', tableName);
        // Detect missing fields
        for (const field of columns) {
            if (!currentFieldNames.includes(field.Field)) {
                differences.push({ type: 'missing_field', tableName, field });
            }
        }

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
            if (field.Type !== currentField.Type) {
                differences.push({ type: 'mismatched_field', tableName, field });
            }
            if (field.Null !== currentField.Null) {
                differences.push({ type: 'mismatched_field', tableName, field });
            }
            if (field.Default !== currentField.Default) {
                differences.push({ type: 'mismatched_field', tableName, field });
            }
        }

        // verify indexes
        logger('Verifying indexes for table', tableName);
        for (const index of indexes) {
            // Check if the current index matches the expected index structure
            const currentIndex = current.tables[tableName].indexes.find(i =>
                i.ColumnName.sort().join(', ') === index.ColumnName.sort().join(', ')
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
            const sortedCurrentIndexColumns = index.ColumnName.sort().join(', ');
            if (!indexes.some(i => i.ColumnName.sort().join(', ') === sortedCurrentIndexColumns)) {
                differences.push({ type: 'extra_index', tableName, indexName: index.Name, index });
            }
        }

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
    }




    // Compare stored procedures
    if (!expected.procedures) throw new Error('No procedures found in expected');
    for (const [procName, contents] of Object.entries(expected.procedures)) {
        if (!current.procedures[procName]) {
            console.log('missing_procedure', contents);
            differences.push({ type: 'missing_procedure', ...contents });
            continue;
        }

        const currentProc = current.procedures[procName];

        // Check if the procedure definition matches
        if (currentProc.Definition !== contents.Definition) {
            const normalizedCurrentDef = normalizeSQLDefinition(currentProc.Definition);
            const normalizedNewDef = normalizeSQLDefinition(contents.Definition);

            if (normalizedCurrentDef !== normalizedNewDef) {
                differences.push({ type: 'mismatched_procedure', ...contents });
            }
        }


    }

    // Compare views
    if (!expected.views) throw new Error('No views found in expected');
    for (const [viewName, expectedDefinition] of Object.entries(expected.views)) {
        if (!current.views[viewName]) {
            differences.push({ type: 'missing_view', viewName, definition: expectedDefinition });
            continue;
        }

        const currentDefinition = current.views[viewName];
        if (currentDefinition !== expectedDefinition) {
            differences.push({ type: 'mismatched_view', viewName, definition: expectedDefinition, current: currentDefinition });
        }
    }

    // Detect extra views
    if (!current.views) throw new Error('No views found in current');
    for (const viewName of Object.keys(current.views)) {
        if (!expected.views[viewName]) {
            differences.push({ type: 'extra_view', viewName });
        }
    }

    return differences;
}