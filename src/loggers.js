let isVerbose = false; // Global variable to manage verbosity

export const setVerbose = (verbose) => {
    isVerbose = verbose; // Function to set the verbosity level
};

export const logger = (...args) => {
    if (isVerbose) {
        console.log(...args); // Log all arguments if verbose is enabled
    }
};

export const logDifferences = (differences, database, dryRun) => {
    const formattedDifferences = differences.map(diff => {
        switch (diff.type) {
            case 'missing_procedure':
                return {
                    Type: diff.type,
                    Name: diff.Name,
                    Details: `Procedure ${diff.Name} is missing`,
                    Action: 'Procedure is missing',
                };
            case 'mismatched_procedure':

                return {
                    Type: diff.type,
                    Name: diff.Name,
                    Details: `Mismatched procedure ${diff.Name}`,
                    Action: 'Mismatched procedure',
                };
            case 'missing_field':
                return {
                    Type: diff.type,
                    Name: diff.tableName,
                    Details: `Field ${diff.field.Field} is missing`,
                    Action: 'Field is missing',
                };
            case 'missing_table':
                return {
                    Type: diff.type,
                    Name: diff.tableName,
                    Details: `Table ${diff.tableName} is missing`,
                    Action: 'Table is missing',
                };
            case 'extra_field':
                return {
                    Type: diff.type,
                    Name: diff.tableName,
                    Details: `Field ${diff.field.Field} is extra`,
                    Action: 'Field is extra',
                };
            case 'extra_table':
                return {
                    Type: diff.type,
                    Name: diff.tableName,
                    Details: `Table ${diff.tableName} is extra`,
                    Action: 'Table is extra',
                };
            case 'missing_view':
                return {
                    Type: diff.type,
                    Name: diff.viewName,
                    Details: `View ${diff.viewName} is missing`,
                    Action: 'View is missing',
                };
            case 'extra_index':
                return {
                    Type: diff.type,
                    Name: diff.tableName,
                    Details: `Index ${diff.index.Name} is extra`,
                    Action: 'Index is extra',
                };
            case 'missing_index':
                return {
                    Type: diff.type,
                    TableName: diff.tableName,
                    Name: diff.index.Name,
                    Details: `Index ${diff.index.Name} is missing`,
                    Action: 'Index is missing',
                };

            case 'mismatched_index':
                return {
                    Type: diff.type,
                    TableName: diff.tableName,
                    Name: diff.index.Name,
                    From: diff.from,
                    Details: `Index ${diff.index.Name} is mismatched`,
                    Action: 'Index is mismatched',
                };

            case 'extra_trigger':
                return {
                    Type: diff.type,
                    Name: diff.trigger.Name,
                    Details: `Trigger ${diff.trigger.Name} is extra`,
                    Action: 'Trigger is extra',
                };
            case 'mismatched_trigger':
                return {
                    Type: diff.type,
                    Name: diff.trigger.Name,
                    Details: `Trigger ${diff.trigger.Name} is mismatched`,
                    Action: 'Trigger is mismatched',
                };  
            case 'missing_trigger':
                console.log('missing_trigger', diff)
                return {
                    Type: diff.type,
                    Name: diff.trigger.Name,
                    Details: `Trigger ${diff.trigger.Name} is missing`,
                    Action: 'Trigger is missing',
                };
            default:
                return {
                    Type: diff.type,
                    Details: `Unhandled difference type: ${diff.type}`,
                };
        }
    });

    // Filter out any undefined or null entries
    const filteredDifferences = formattedDifferences.filter(diff => diff);

    // Log the differences in a table format
    if (filteredDifferences.length > 0) {
        if (dryRun) {
            logger(`Dry Run: Differences for database ${database}:`);
        } else {
            logger(`Differences applied for database ${database}:`);
        }
        console.table(filteredDifferences);
    } else {
        if (dryRun) {
            logger(`Dry Run: No differences found. Database: ${database}`);
        } else {
            logger(`No differences found. Database: ${database}`);
        }
    }
}