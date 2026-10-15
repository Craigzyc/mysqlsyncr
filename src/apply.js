import { logger } from './loggers.js';

const quoteString = (value) => `'${String(value).replace(/\\/g, '\\\\').replace(/'/g, "''")}'`;

// Types MySQL won't give a literal default
const noLiteralDefaultRegex = /^(tiny|medium|long)?(text|blob)$|^json$|^geometry|^point$|^linestring$|^polygon$/i;

const defaultClause = (field) => {
    const value = field.Default;
    if (value === undefined || value === null || value === 'NULL') {
        // A NOT NULL column can't default to NULL; leave it without a default
        return field.NotNull ? '' : 'DEFAULT NULL';
    }
    // Functions, expressions, and bit/hex literals such as b'0' are written as they were read
    if (/^(CURRENT_TIMESTAMP|now)(\(\d*\))?$/i.test(value) || value.startsWith('(') || /^[bx]'[0-9a-f]*'$/i.test(value) || /^0x[0-9a-f]+$/i.test(value)) {
        return `DEFAULT ${value}`;
    }
    if (noLiteralDefaultRegex.test(field.Type)) {
        return '';
    }
    return `DEFAULT ${quoteString(value)}`;
}

// Template value for a column detail, or the live column's when the template doesn't record it
const columnDetail = (field, currentField, key) => key in field ? field[key] : currentField?.[key];

/**
 * Full column definition for ADD/CHANGE, e.g.
 *   timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
 * NULL/NOT NULL is always explicit: without it a timestamp is NOT NULL when
 * explicit_defaults_for_timestamp is OFF, and DEFAULT NULL then fails.
 * Charset, collation, comment, ON UPDATE and a generated column's expression
 * come from the template when it has them and are otherwise kept from the live
 * column, since CHANGE drops anything not restated.
 */
export const columnDefinition = (field, currentField) => {
    const charset = columnDetail(field, currentField, 'Charset');
    const collate = columnDetail(field, currentField, 'Collate');
    const onUpdate = columnDetail(field, currentField, 'OnUpdate');
    const comment = columnDetail(field, currentField, 'Comment');
    const generated = columnDetail(field, currentField, 'Generated');
    if (generated) {
        // A generated column takes no DEFAULT, ON UPDATE or AUTO_INCREMENT
        return [
            field.Type,
            charset ? `CHARACTER SET ${charset}` : '',
            collate ? `COLLATE ${collate}` : '',
            `GENERATED ALWAYS AS ${generated}`,
            field.NotNull ? 'NOT NULL' : 'NULL',
            comment ? `COMMENT ${quoteString(comment)}` : ''
        ].filter(Boolean).join(' ');
    }
    return [
        field.Type,
        charset ? `CHARACTER SET ${charset}` : '',
        collate ? `COLLATE ${collate}` : '',
        field.NotNull ? 'NOT NULL' : 'NULL',
        defaultClause(field),
        onUpdate ? `ON UPDATE ${onUpdate}` : '',
        field.AutoIncrement ? 'AUTO_INCREMENT' : '',
        comment ? `COMMENT ${quoteString(comment)}` : ''
    ].filter(Boolean).join(' ');
}

// `col`, or `col`(255) for a prefix index on a text column
const formatIndexColumns = (columns) => columns.map(col => {
    const match = col.match(/^`?([^`(]+)`?(?:\((\d+)\))?$/);
    if (!match) return `\`${col}\``;
    return `\`${match[1]}\`${match[2] ? `(${match[2]})` : ''}`;
}).join(', ');

const isPrimaryIndex = (index) => !!index.Primary || index.Name === 'PRIMARY';

const addIndexClause = (index) => isPrimaryIndex(index)
    ? `ADD PRIMARY KEY (${formatIndexColumns(index.ColumnName)})`
    : `ADD ${index.Unique ? 'UNIQUE ' : ''}INDEX \`${index.Name}\` (${formatIndexColumns(index.ColumnName)})`;

const dropIndexClause = (index) => isPrimaryIndex(index) ? 'DROP PRIMARY KEY' : `DROP INDEX \`${index.Name}\``;

const describeDifference = (diff) => {
    const name = diff.tableName || diff.viewName || diff.Name || diff.database || '';
    const detail = diff.field?.Field || diff.indexName || diff.trigger?.Name || (diff.key ? JSON.stringify(diff.key) : '');
    return `${diff.type} ${name}${detail ? '.' + detail : ''}`;
}

/**
 * Apply the differences in order. A failing difference doesn't stop the rest;
 * once all have been tried, throws an Error whose `errors` lists each failure
 * as { difference, error }.
 */
export const applyDifferences = async (connection, database, differences) => {
    const errors = [];
   
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
            'extra_trigger': 7,
            // after the table and its columns exist
            'missing_row': 8
        };
        
        return (typePriority[a.type] || 999) - (typePriority[b.type] || 999);
    })


    for (const diff of differences) {
        try {

            if(diff.type == 'missing_database'){
                const createDatabaseSQL = `CREATE DATABASE \`${diff.database}\`;`;
                console.log(`Executing: ${createDatabaseSQL}`);
                await connection.query(createDatabaseSQL);
                continue;
            }


            await connection.query(`USE \`${database}\``);
            if (diff.type === 'missing_table') {
                const { tableName, createSQL } = diff;
                logger(`Creating missing table ${tableName}`);
                console.log(`Executing: ${createSQL}`);
                await connection.query(createSQL);

            } else if (diff.type === 'extra_table') {
                const { tableName } = diff;
                logger(`Dropping extra table ${tableName}`);
                const dropTableSQL = `DROP TABLE \`${tableName}\`;`;
                console.log(`Executing: ${dropTableSQL}`);
                await connection.query(dropTableSQL);

            } else if (diff.type === 'missing_field') {
                // Existing rows get the column's default, or the type's implicit default for NOT NULL without one
                const addFieldSQL = `ALTER TABLE \`${diff.tableName}\` ADD COLUMN \`${diff.field.Field}\` ${columnDefinition(diff.field)};`;
                console.log(`Executing: ${addFieldSQL}`);
                await connection.query(addFieldSQL);

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
                    const modifyFieldSQL = `ALTER TABLE \`${tableName}\` CHANGE \`${field.Field}\` \`${field.Field}\` ${columnDefinition(field, currentField)};`;
                    console.log(`Executing: ${modifyFieldSQL}`);
                    await connection.query(modifyFieldSQL);
                // }

            } else if (diff.type === 'missing_index') {
                const existingColumns = await connection.query(`SHOW COLUMNS FROM \`${diff.tableName}\``);
                const columnNames = existingColumns.map(col => col.Field);

                // Check if all columns for the index exist
                const missingColumns = Array.isArray(diff.index.ColumnName) ? diff.index.ColumnName.filter(col => !columnNames.includes(col) && !columnNames.includes(col.split("(")?.[0])) : [];

                if (missingColumns.length > 0) {
                    throw new Error(`Cannot create index ${diff.index.Name} on ${diff.tableName}. Missing columns: ${missingColumns.join(', ')}`);
                }

                if (!Array.isArray(diff.index.ColumnName) || diff.index.ColumnName.length === 0) {
                    throw new Error(`Cannot create index ${diff.index.Name} on ${diff.tableName}. ColumnName is undefined or empty.`);
                }
                const addIndexSQL = `ALTER TABLE \`${diff.tableName}\` ${addIndexClause(diff.index)};`;
                console.log(`Executing: ${addIndexSQL}`);
                await connection.query(addIndexSQL);

            } else if (diff.type === 'extra_index') {
                const dropIndexSQL = `ALTER TABLE \`${diff.tableName}\` ${dropIndexClause(diff.index)};`;
                console.log(`Executing: ${dropIndexSQL}`);
                await connection.query(dropIndexSQL);

            } else if (diff.type === 'mismatched_index') {
                const { tableName, index } = diff;
                // Drop and re-add in one statement: the index is never missing if the add fails,
                // and a primary key on an AUTO_INCREMENT column can be replaced
                const replaceIndexSQL = `ALTER TABLE \`${tableName}\` ${dropIndexClause(index)}, ${addIndexClause(index)};`;
                console.log(`Executing: ${replaceIndexSQL}`);
                await connection.query(replaceIndexSQL);

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

            } else if (diff.type === 'missing_row') {
                const columns = Object.keys(diff.row);
                const insertRowSQL = `INSERT INTO \`${diff.tableName}\` (${columns.map(col => `\`${col}\``).join(', ')}) VALUES (${columns.map(() => '?').join(', ')});`;
                console.log(`Executing: ${insertRowSQL}`, JSON.stringify(diff.row));
                await connection.query(insertRowSQL, columns.map(col => diff.row[col]));

            }else if(diff.type === 'missing_database'){
                logger('fixing missing database', diff.database)
                const createDatabaseSQL = `CREATE DATABASE \`${diff.database}\`;`;
                console.log(`Executing: ${createDatabaseSQL}`);
                await connection.query(createDatabaseSQL);
            } else {
                throw new Error(`Unknown difference type: ${diff.type}`);
            }
        } catch (e) {
            console.error(`Error applying ${describeDifference(diff)}: ${e.message}`);
            logger(diff);
            errors.push({ difference: describeDifference(diff), error: e.message });
        }
    }

    if (errors.length > 0) {
        const error = new Error(`${errors.length} of ${differences.length} difference(s) failed to apply: ${errors.map(e => `${e.difference} (${e.error})`).join('; ')}`);
        error.errors = errors;
        throw error;
    }
}