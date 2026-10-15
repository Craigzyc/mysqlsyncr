import { logger } from './loggers.js';

// Names a difference the way the caller would recognise it in the UI.
const describeDiff = (diff) => {
    const name = diff.indexName || diff.index?.Name || diff.viewName || diff.trigger?.Name
        || diff.field?.Field || diff.Name || diff.tableName || '';
    const where = diff.tableName && name !== diff.tableName ? ` on ${diff.tableName}` : '';
    return `${diff.type} ${name}${where}`.trim();
};

// MySQL 8 added the _0900_ collation family, which does not exist on 5.7. The _unicode_ci
// collation of the same charset is accent- and case-insensitive like _0900_ai_ci and is
// present on both versions, so a table created with it means the same thing either way -
// unlike dropping the clause, which would resolve to a different default per server.
const portableCollation = (collation) => {
    const match = /^(\w+?)_0900_(?:ai_ci|as_ci)$/i.exec(collation);
    return match ? `${match[1]}_unicode_ci` : null;
};

// Rewrites one collation in a CREATE TABLE, both as a table option (COLLATE=x) and as a
// column attribute (COLLATE x). Passing null for `to` removes the clause entirely.
const replaceCollation = (sql, from, to) => {
    const escaped = from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return sql
        .replace(new RegExp('COLLATE(\\s*)=(\\s*)' + escaped, 'gi'), to ? `COLLATE$1=$2${to}` : '')
        .replace(new RegExp('COLLATE(\\s+)' + escaped, 'gi'), to ? `COLLATE$1${to}` : '');
};

// Rewrites that let DDL dumped from a newer server run on an older one. Each inspects the
// error the server actually returned and returns the amended SQL plus what changed, or
// null when it has nothing to offer - so a rewrite only ever fires for the failure it
// was written for, and anything else still surfaces as a failure.
const compatRewrites = [
    (sql, errorMessage) => {
        const unknown = /Unknown collation: '([^']+)'/i.exec(errorMessage);
        if (!unknown) return null;
        const substitute = portableCollation(unknown[1]);
        const rewritten = replaceCollation(sql, unknown[1], substitute);
        if (rewritten === sql) return null;
        return {
            sql: rewritten,
            message: `server does not support collation ${unknown[1]}, created with ${substitute || 'the charset default'} instead`,
        };
    },
    (sql, errorMessage) => {
        // Index visibility is MySQL 8.0.23+. Only strip the keyword where it is legal -
        // directly after an index definition's closing parenthesis - so the word cannot
        // be removed from a column comment or a column named `visible`.
        if (!/error in your SQL syntax/i.test(errorMessage) || !/\b(?:IN)?VISIBLE\b/i.test(errorMessage)) return null;
        const rewritten = sql.replace(/\)(\s+)(?:IN)?VISIBLE(?=\s*[,)\r\n])/g, ')');
        if (rewritten === sql) return null;
        return {
            sql: rewritten,
            message: 'server does not support index visibility, created with every index visible',
        };
    },
];

export const applyDifferences = async (connection, database, differences) => {
    // Every difference that could not be applied, so the caller can tell the user which
    // ones are still outstanding and why. These used to be swallowed by a logger() call
    // that only prints under --verbose, so a failed apply looked identical to a
    // successful one and the same differences simply reappeared on the next compare.
    const failures = [];
    // Differences that were applied, but not exactly as the dump describes them.
    const warnings = [];

    // A dump written by MySQL 8 assumes explicit_defaults_for_timestamp is on, where a
    // `timestamp NOT NULL` column with no DEFAULT is just a column with no default. With
    // the MySQL 5.7 default of off, the server instead assigns every TIMESTAMP NOT NULL
    // column after the first an implicit '0000-00-00 00:00:00', which strict mode then
    // rejects at CREATE TABLE time. Matching MySQL 8 for this session applies that DDL as
    // written; DDL that states its defaults - everything SHOW CREATE TABLE emits, on
    // either version - parses the same way with the setting on or off.
    try {
        await connection.query('SET SESSION explicit_defaults_for_timestamp = 1');
    } catch (e) {
        logger(`Could not set explicit_defaults_for_timestamp for this session: ${e.message}`);
    }

    differences.sort((a, b) => {
        //Sort to make sure we apply the differences in a logical order.
        const typePriority = {
            'missing_database': 1,
            'missing_table': 2,
            'extra_table': 2,
            'missing_field': 3,
            'extra_field': 3,
            'mismatched_field': 3,
            'missing_index': 4,
            'extra_index': 4,
            'mismatched_index': 4,
            'missing_procedure': 5,
            'mismatched_procedure': 5,
            'missing_view': 6,
            'mismatched_view': 6,
            'extra_view': 6,
            'missing_trigger': 7,
            'mismatched_trigger': 7,
            'extra_trigger': 7
        };
        
        return (typePriority[a.type] || 999) - (typePriority[b.type] || 999);
    })


    for (const diff of differences) {
        try {

            if(diff.type == 'missing_database'){
                const createDatabaseSQL = `CREATE DATABASE \`${differences[0].database}\`;`;
                console.log(`Executing: ${createDatabaseSQL}`);
                await connection.query(createDatabaseSQL);
                continue;
            }


            await connection.query(`USE \`${database}\``);
            if (diff.type === 'missing_table') {
                const { tableName, createSQL } = diff;
                logger(`Creating missing table ${tableName}`);
                console.log(`Executing: ${createSQL}`);
                try {
                    await connection.query(createSQL);
                } catch (e) {
                    // The dump can name things this server has never heard of - a MySQL 8
                    // collation, index visibility. Amend the statement for whatever the
                    // server objected to and retry, one objection at a time, since it only
                    // reports the first. The table then exists, but not exactly as dumped,
                    // so record every change rather than calling it a clean success.
                    let sql = createSQL;
                    let error = e;
                    const changes = [];

                    while (error && changes.length < compatRewrites.length) {
                        const message = error.message;
                        const rewrite = compatRewrites.reduce((found, fn) => found || fn(sql, message), null);
                        if (!rewrite) break;

                        sql = rewrite.sql;
                        changes.push(rewrite.message);
                        console.log(`Retrying: ${sql}`);
                        try {
                            await connection.query(sql);
                            error = null;
                        } catch (retryError) {
                            error = retryError;
                        }
                    }

                    if (error) throw error;

                    const message = changes.join('; ');
                    console.warn(`Applied ${describeDiff(diff)} with a change: ${message}`);
                    warnings.push({ type: diff.type, tableName, description: describeDiff(diff), message });
                }

            } else if (diff.type === 'extra_table') {
                const { tableName } = diff;
                logger(`Dropping extra table ${tableName}`);
                const dropTableSQL = `DROP TABLE \`${tableName}\`;`;
                console.log(`Executing: ${dropTableSQL}`);
                await connection.query(dropTableSQL);

            } else if (diff.type === 'missing_field') {
                // Step 1: Add column with DEFAULT NULL to handle existing records
                const addFieldSQL = `ALTER TABLE \`${diff.tableName}\` ADD \`${diff.field.Field}\` ${diff.field.Type} DEFAULT NULL;`;
                console.log(`Executing: ${addFieldSQL}`);
                await connection.query(addFieldSQL);

                // Step 2: If NOT NULL is required and no default was specified, modify the column to remove DEFAULT NULL
                if (diff.field.NotNull && !diff.field.Default) {
                    const modifyFieldSQL = `ALTER TABLE \`${diff.tableName}\` MODIFY \`${diff.field.Field}\` ${diff.field.Type} NOT NULL;`;
                    console.log(`Executing: ${modifyFieldSQL}`);
                    await connection.query(modifyFieldSQL);
                }
                if(diff.field.Default){
                    const defaultClause = diff.field.Default === 'CURRENT_TIMESTAMP' 
                    ? 'DEFAULT CURRENT_TIMESTAMP'
                    : diff.field.Default !== undefined && diff.field.Default !== null 
                        ? `DEFAULT '${diff.field.Default}'` 
                        : '';
                    const modifyFieldSQL = `ALTER TABLE \`${diff.tableName}\` MODIFY \`${diff.field.Field}\` ${diff.field.Type} ${defaultClause};`;
                    console.log(`Executing: ${modifyFieldSQL}`);
                    await connection.query(modifyFieldSQL);
                }

            } else if (diff.type === 'extra_field') {
                const dropFieldSQL = `ALTER TABLE \`${diff.tableName}\` DROP COLUMN \`${diff.field.Field}\`;`;
                console.log(`Executing: ${dropFieldSQL}`);
                await connection.query(dropFieldSQL);

            } else if (diff.type === 'mismatched_field') {
                const { tableName, field, currentField } = diff;

                // use alter table rather than adding fields
                
                // // Helper function to determine if we need batch processing
                // const needsBatchProcessing = () => {
                //     const currentType = currentField.Type.toLowerCase();
                //     const newType = field.Type.toLowerCase();
                    
                //     // Decimal changes
                //     if (currentType.includes('decimal') && newType.includes('decimal')) {
                //         return true;
                //     }
                    
                //     // VARCHAR/CHAR length reductions
                //     if ((currentType.includes('varchar') || currentType.includes('char')) &&
                //         (newType.includes('varchar') || newType.includes('char'))) {
                //         const currentLength = parseInt(currentType.match(/\((\d+)\)/)?.[1] || '0');
                //         const newLength = parseInt(newType.match(/\((\d+)\)/)?.[1] || '0');
                //         return newLength < currentLength;
                //     }
                    
                //     // TEXT to VARCHAR conversions
                //     if (currentType.includes('text') && newType.includes('varchar')) {
                //         return true;
                //     }
                    
                //     // Numeric type downgrades
                //     const numericDowngrades = {
                //         'bigint': ['int', 'mediumint', 'smallint', 'tinyint'],
                //         'int': ['mediumint', 'smallint', 'tinyint'],
                //         'mediumint': ['smallint', 'tinyint'],
                //         'smallint': ['tinyint'],
                //         'double': ['float', 'decimal'],
                //         'float': ['decimal']
                //     };
                    
                //     for (const [larger, smaller] of Object.entries(numericDowngrades)) {
                //         if (currentType.includes(larger) && smaller.some(t => newType.includes(t))) {
                //             return true;
                //         }
                //     }
                    
                //     return false;
                // };

                // if (needsBatchProcessing()) {
                //     // Step 1: Add new column
                //     const addColumnSQL = `ALTER TABLE \`${tableName}\` ADD COLUMN \`${field.Field}_new\` ${field.Type} DEFAULT NULL;`;
                //     console.log(`Adding new column for type conversion: ${addColumnSQL}`);
                //     await connection.query(addColumnSQL);

                //     // Step 2: Copy data in batches
                //     let totalUpdated = 0;
                //     let batchSize = 10000;
                //     let batchCount = 0;
                    
                //     while (true) {
                //         const updateSQL = `
                //             UPDATE \`${tableName}\` 
                //             SET \`${field.Field}_new\` = \`${field.Field}\`
                //             WHERE \`${field.Field}_new\` IS NULL 
                //             AND \`${field.Field}\` IS NOT NULL
                //             LIMIT ${batchSize};
                //         `;
                //         const result = await connection.query(updateSQL);
                //         const rowsAffected = result.affectedRows;
                        
                //         if (rowsAffected === 0) break;
                        
                //         totalUpdated += rowsAffected;
                //         batchCount++;
                //         console.log(`Batch ${batchCount}: Converted ${rowsAffected} rows. Total converted: ${totalUpdated}`);
                //     }

                //     // Step 3: Verify data (optional)
                //     const verifySQL = `
                //         SELECT COUNT(*) as mismatch FROM \`${tableName}\`
                //         WHERE \`${field.Field}\` IS NOT NULL 
                //         AND \`${field.Field}_new\` IS NULL;
                //     `;
                //     const [verifyResult] = await connection.query(verifySQL);
                //     if (verifyResult.mismatch > 0) {
                //         console.log(`Warning: ${verifyResult.mismatch} rows may have failed conversion`);
                //     }

                //     // Step 4: Swap columns
                //     const swapColumnsSQL = `
                //         ALTER TABLE \`${tableName}\`
                //         DROP COLUMN \`${field.Field}\`,
                //         RENAME COLUMN \`${field.Field}_new\` TO \`${field.Field}\`
                //     `;
                //     console.log(`Executing: ${swapColumnsSQL}`);
                //     await connection.query(swapColumnsSQL);
                    
                //     console.log(`Completed type conversion for ${field.Field}. Total rows converted: ${totalUpdated}`);
                // } else {
                    // Original mismatched field handling for simple changes
                    const isTimestamp = field.Type.toLowerCase().includes('timestamp');
                    
                    // Handle timestamp specific attributes
                    const defaultClause = field.Default === 'CURRENT_TIMESTAMP' 
                        ? 'DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP'
                        : field.Default === 'NULL'
                            ? isTimestamp ? 'NULL DEFAULT NULL' : 'DEFAULT NULL'
                            : field.Default !== undefined && field.Default !== null 
                                ? `DEFAULT '${field.Default}'` 
                                : isTimestamp ? 'NULL DEFAULT NULL' : 'DEFAULT NULL';
                    
                    // Remove ON UPDATE CURRENT_TIMESTAMP if we're changing away from CURRENT_TIMESTAMP
                    const hasOnUpdate = currentField?.Default === 'CURRENT_TIMESTAMP' && 
                        field.Default !== 'CURRENT_TIMESTAMP';
                    
                    const modifyFieldSQL = `ALTER TABLE \`${tableName}\` CHANGE \`${field.Field}\` \`${field.Field}\` ${field.Type} ${field.NotNull ? 'NOT NULL' : ''} ${defaultClause}${hasOnUpdate ? ' ON UPDATE CURRENT_TIMESTAMP' : ''};`;
                    console.log(`Executing: ${modifyFieldSQL}`);
                    await connection.query(modifyFieldSQL);
                // }

            } else if (diff.type === 'missing_index') {
                const existingColumns = await connection.query(`SHOW COLUMNS FROM \`${diff.tableName}\``);
                const columnNames = existingColumns.map(col => col.Field);

                // Check if all columns for the index exist
                const missingColumns = Array.isArray(diff.index.ColumnName) ? diff.index.ColumnName.filter(col => !columnNames.includes(col) && !columnNames.includes(col.split("(")?.[0])) : [];

                if (missingColumns.length > 0) {
                    const message = `Missing columns: ${missingColumns.join(', ')}`;
                    logger(`Cannot create index ${diff.index.Name} on ${diff.tableName}. ${message}`);
                    console.error(`Failed to apply ${describeDiff(diff)}: ${message}`);
                    failures.push({ type: diff.type, tableName: diff.tableName, description: describeDiff(diff), message });
                    continue; // Skip index creation if columns are missing
                }

                // Prepare the index columns with proper formatting
                const indexColumns = diff.index.ColumnName.map(col => {
                    if(col.includes("(")){                        
                        
                        const match = col.match(/^(?:`([^`]+)`|([A-Za-z_][A-Za-z0-9_\$]*))\((\d+)\)$/);

                        if (match) {
                            const name = match[1] || match[2]; // one of them will be filled
                            const size = match[3];
                            console.log(name, size);
                            return `\`${name}\`(${size})`;
                        }

                        return `\`${col.split("(")[0]}\``
                    } else {
                        return `\`${col}\``; // Format column names
                    }
                });
                // Handle PRIMARY index creation
                if (diff.index.Name === 'PRIMARY') {
                    if (indexColumns.length > 0) {
                        const primaryKeySQL = `ALTER TABLE \`${diff.tableName}\` ADD PRIMARY KEY (${indexColumns.join(', ')});`;
                        console.log(`Executing: ${primaryKeySQL}`);
                        await connection.query(primaryKeySQL);
                    } else {
                        logger(`Cannot create PRIMARY index on ${diff.tableName}. ColumnName is undefined or empty.`, diff.index);
                    }
                } else {
                    // Create the new index with UNIQUE if applicable
                    const uniqueSQL = diff.index.Unique ? 'UNIQUE ' : ''; // Check if the index is unique
                    if (indexColumns.length > 0) {
                        const addIndexSQL = `ALTER TABLE \`${diff.tableName}\` ADD ${uniqueSQL}INDEX \`${diff.index.Name}\` (${indexColumns.join(', ')});`;
                        console.log(`Executing: ${addIndexSQL}`);
                        await connection.query(addIndexSQL);
                    } else {
                        logger(`Cannot create index ${diff.index.Name} on ${diff.tableName}. ColumnName is undefined or empty.`, diff.index);
                    }
                }

            } else if (diff.type === 'extra_index') {
                // Handle dropping of extra indexes
                if (diff.index.Name === 'PRIMARY') {
                    const dropPrimaryKeySQL = `ALTER TABLE \`${diff.tableName}\` DROP PRIMARY KEY;`;
                    console.log(`Executing: ${dropPrimaryKeySQL}`);
                    await connection.query(dropPrimaryKeySQL);
                } else {
                    const dropIndexSQL = `DROP INDEX \`${diff.index.Name}\` ON \`${diff.tableName}\`;`;
                    console.log(`Executing: ${dropIndexSQL}`);
                    await connection.query(dropIndexSQL);
                }

            } else if (diff.type === 'mismatched_index') {
                const { tableName, index } = diff;
                // Drop the existing index
                if (index.Name === 'PRIMARY') {
                    const dropPrimaryKeySQL = `ALTER TABLE \`${tableName}\` DROP PRIMARY KEY;`;
                    console.log(`Executing: ${dropPrimaryKeySQL}`);
                    await connection.query(dropPrimaryKeySQL);
                } else {
                    const dropIndexSQL = `DROP INDEX \`${index.Name}\` ON \`${tableName}\`;`;
                    console.log(`Executing: ${dropIndexSQL}`);
                    await connection.query(dropIndexSQL);
                }
                console.log('index', index)

                // Create the new index
                const uniqueSQL = index.Unique ? 'UNIQUE ' : ''; // Check if the index is unique
                if (index.Name === 'PRIMARY') {
                    const addPrimaryKeySQL = `ALTER TABLE \`${tableName}\` ADD PRIMARY KEY (${index.ColumnName.join(', ')});`;
                    console.log(`Executing: ${addPrimaryKeySQL}`);
                    await connection.query(addPrimaryKeySQL);
                } else {
                    const addIndexSQL = `ALTER TABLE \`${tableName}\` ADD ${uniqueSQL}INDEX \`${index.Name}\` (${index.ColumnName.join(', ')});`; // Include UNIQUE if applicable
                    console.log(`Executing: ${addIndexSQL}`);
                    await connection.query(addIndexSQL);
                }

            } else if (diff.type === 'missing_procedure' || diff.type === 'mismatched_procedure') {

                // Drop the procedure if it exists
                const dropCurrentProcSQL = `DROP PROCEDURE IF EXISTS \`${diff.Name}\`;`;
                console.log(`Executing: ${dropCurrentProcSQL}`);
                await connection.query(dropCurrentProcSQL);

                // Create the procedure
                const createProcSQL = diff.Definition;
                console.log(`Executing: ${createProcSQL}`); // Log the SQL statement
                await connection.query(createProcSQL);



            } else if (diff.type === 'missing_view') {
                const dropViewSQL = `DROP VIEW IF EXISTS \`${diff.viewName}\`;`;
                console.log(`Executing: ${dropViewSQL}`);
                await connection.query(dropViewSQL);
                const createViewSQL = diff.definition; // Use the expected definition to create the view
                console.log(`Executing: ${createViewSQL}`);
                await connection.query(createViewSQL);


            } else if (diff.type === 'mismatched_view') {
                const dropViewSQL = `DROP VIEW IF EXISTS \`${diff.viewName}\`;`;
                console.log(`Executing: ${dropViewSQL}`);
                await connection.query(dropViewSQL);
                const createViewSQL = diff.definition; // Use the expected definition to create the view
                console.log(`Executing: ${createViewSQL}`);
                await connection.query(createViewSQL);


            } else if (diff.type === 'extra_view') {
                const dropViewSQL = `DROP VIEW IF EXISTS \`${diff.viewName}\`;`;
                console.log(`Executing: ${dropViewSQL}`);
                await connection.query(dropViewSQL);


            } else if (diff.type === 'missing_trigger') {
                const createTriggerSQL = diff.trigger.Definition;
                logger('fixing trigger', diff.trigger.Name)
                console.log(`Executing: ${createTriggerSQL}`);
                await connection.query(createTriggerSQL);


            } else if (diff.type === 'mismatched_trigger') {
                const dropTriggerSQL = `DROP TRIGGER IF EXISTS \`${diff.trigger.Name}\`;`;
                console.log(`Executing: ${dropTriggerSQL}`);
                await connection.query(dropTriggerSQL);
                const createTriggerSQL = diff.trigger.Definition;
                console.log(`Executing: ${createTriggerSQL}`);
                await connection.query(createTriggerSQL);


            } else if (diff.type === 'extra_trigger') {
                const dropTriggerSQL = `DROP TRIGGER IF EXISTS \`${diff.trigger.Name}\`;`;
                console.log(`Executing: ${dropTriggerSQL}`);
                await connection.query(dropTriggerSQL);

            }else if(diff.type === 'missing_database'){
                logger('fixing missing database', diff.database)
                const createDatabaseSQL = `CREATE DATABASE \`${diff.database}\`;`;
                console.log(`Executing: ${createDatabaseSQL}`);
                await connection.query(createDatabaseSQL);
            } else {
                logger(`Error applying difference of type:${diff.type}`, diff)
            }
        } catch (e) {
            logger(`Error applying difference of type:${diff.type}. Error: ${e.message}`, diff);
            console.error(`Failed to apply ${describeDiff(diff)}: ${e.message}`);
            failures.push({ type: diff.type, tableName: diff.tableName, description: describeDiff(diff), message: e.message });
        }
    }

    return { attempted: differences.length, failures, warnings };
}