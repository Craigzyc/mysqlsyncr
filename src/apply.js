import { logger } from './loggers.js';
import { adaptSQLForServer, getServerVersion, portableCollation } from './versions.js';

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
// was written for, and anything else still surfaces as a failure. These catch what
// adaptSQLForServer can't anticipate, e.g. when the server's version couldn't be read.
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

/**
 * Apply the differences in order. A failing difference doesn't stop the rest.
 * Returns { attempted, failures, warnings }: failures are the differences that
 * couldn't be applied, warnings the ones applied with a change for this server
 * (e.g. an 8.0 collation on 5.7), each as { type, tableName, description, message }.
 */
export const applyDifferences = async (connection, database, differences) => {
    const failures = [];
    const warnings = [];
    let current = null; // the difference being applied, for warnings from query()
    const warn = (diff, message) => {
        console.warn(`Applied ${describeDifference(diff)} with a change: ${message}`);
        warnings.push({ type: diff.type, tableName: diff.tableName, description: describeDifference(diff), message });
    };

    // Template SQL from MySQL 8.0 can name collations a 5.7 server doesn't have
    const serverVersion = await getServerVersion(connection);
    const query = async (sql, values) => {
        const adapted = adaptSQLForServer(sql, serverVersion);
        if (adapted !== sql) {
            console.log(`Adapted for MySQL ${serverVersion}: ${adapted}`);
            if (current) warn(current, `MySQL ${serverVersion} has no utf8mb4_0900 collations, so the closest one it has was used`);
        }
        return connection.query(adapted, values);
    };

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
            'extra_trigger': 7,
            // after the table and its columns exist
            'missing_row': 8
        };
        
        return (typePriority[a.type] || 999) - (typePriority[b.type] || 999);
    })


    for (const diff of differences) {
        current = diff;
        try {

            if(diff.type == 'missing_database'){
                const createDatabaseSQL = `CREATE DATABASE \`${diff.database}\`;`;
                console.log(`Executing: ${createDatabaseSQL}`);
                await query(createDatabaseSQL);
                continue;
            }


            await query(`USE \`${database}\``);
            if (diff.type === 'missing_table') {
                const { tableName, createSQL } = diff;
                logger(`Creating missing table ${tableName}`);
                console.log(`Executing: ${createSQL}`);
                try {
                    await query(createSQL);
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
                            await query(sql);
                            error = null;
                        } catch (retryError) {
                            error = retryError;
                        }
                    }

                    if (error) throw error;
                    warn(diff, changes.join('; '));
                }

            } else if (diff.type === 'extra_table') {
                const { tableName } = diff;
                logger(`Dropping extra table ${tableName}`);
                const dropTableSQL = `DROP TABLE \`${tableName}\`;`;
                console.log(`Executing: ${dropTableSQL}`);
                await query(dropTableSQL);

            } else if (diff.type === 'missing_field') {
                // Existing rows get the column's default, or the type's implicit default for NOT NULL without one
                const addFieldSQL = `ALTER TABLE \`${diff.tableName}\` ADD COLUMN \`${diff.field.Field}\` ${columnDefinition(diff.field)};`;
                console.log(`Executing: ${addFieldSQL}`);
                await query(addFieldSQL);

            } else if (diff.type === 'extra_field') {
                const dropFieldSQL = `ALTER TABLE \`${diff.tableName}\` DROP COLUMN \`${diff.field.Field}\`;`;
                console.log(`Executing: ${dropFieldSQL}`);
                await query(dropFieldSQL);

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
                //     await query(addColumnSQL);

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
                //         const result = await query(updateSQL);
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
                //     const [verifyResult] = await query(verifySQL);
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
                //     await query(swapColumnsSQL);
                    
                //     console.log(`Completed type conversion for ${field.Field}. Total rows converted: ${totalUpdated}`);
                // } else {
                    // Original mismatched field handling for simple changes
                    const modifyFieldSQL = `ALTER TABLE \`${tableName}\` CHANGE \`${field.Field}\` \`${field.Field}\` ${columnDefinition(field, currentField)};`;
                    console.log(`Executing: ${modifyFieldSQL}`);
                    await query(modifyFieldSQL);
                // }

            } else if (diff.type === 'missing_index') {
                const existingColumns = await query(`SHOW COLUMNS FROM \`${diff.tableName}\``);
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
                await query(addIndexSQL);

            } else if (diff.type === 'extra_index') {
                const dropIndexSQL = `ALTER TABLE \`${diff.tableName}\` ${dropIndexClause(diff.index)};`;
                console.log(`Executing: ${dropIndexSQL}`);
                await query(dropIndexSQL);

            } else if (diff.type === 'mismatched_index') {
                const { tableName, index } = diff;
                // Drop and re-add in one statement: the index is never missing if the add fails,
                // and a primary key on an AUTO_INCREMENT column can be replaced
                const replaceIndexSQL = `ALTER TABLE \`${tableName}\` ${dropIndexClause(index)}, ${addIndexClause(index)};`;
                console.log(`Executing: ${replaceIndexSQL}`);
                await query(replaceIndexSQL);

            } else if (diff.type === 'missing_procedure' || diff.type === 'mismatched_procedure') {

                // Drop the procedure if it exists
                const dropCurrentProcSQL = `DROP PROCEDURE IF EXISTS \`${diff.Name}\`;`;
                console.log(`Executing: ${dropCurrentProcSQL}`);
                await query(dropCurrentProcSQL);

                // Create the procedure
                const createProcSQL = diff.Definition;
                console.log(`Executing: ${createProcSQL}`); // Log the SQL statement
                await query(createProcSQL);



            } else if (diff.type === 'missing_view') {
                const dropViewSQL = `DROP VIEW IF EXISTS \`${diff.viewName}\`;`;
                console.log(`Executing: ${dropViewSQL}`);
                await query(dropViewSQL);
                const createViewSQL = diff.definition; // Use the expected definition to create the view
                console.log(`Executing: ${createViewSQL}`);
                await query(createViewSQL);


            } else if (diff.type === 'mismatched_view') {
                const dropViewSQL = `DROP VIEW IF EXISTS \`${diff.viewName}\`;`;
                console.log(`Executing: ${dropViewSQL}`);
                await query(dropViewSQL);
                const createViewSQL = diff.definition; // Use the expected definition to create the view
                console.log(`Executing: ${createViewSQL}`);
                await query(createViewSQL);


            } else if (diff.type === 'extra_view') {
                const dropViewSQL = `DROP VIEW IF EXISTS \`${diff.viewName}\`;`;
                console.log(`Executing: ${dropViewSQL}`);
                await query(dropViewSQL);


            } else if (diff.type === 'missing_trigger') {
                const createTriggerSQL = diff.trigger.Definition;
                logger('fixing trigger', diff.trigger.Name)
                console.log(`Executing: ${createTriggerSQL}`);
                await query(createTriggerSQL);


            } else if (diff.type === 'mismatched_trigger') {
                const dropTriggerSQL = `DROP TRIGGER IF EXISTS \`${diff.trigger.Name}\`;`;
                console.log(`Executing: ${dropTriggerSQL}`);
                await query(dropTriggerSQL);
                const createTriggerSQL = diff.trigger.Definition;
                console.log(`Executing: ${createTriggerSQL}`);
                await query(createTriggerSQL);


            } else if (diff.type === 'extra_trigger') {
                const dropTriggerSQL = `DROP TRIGGER IF EXISTS \`${diff.trigger.Name}\`;`;
                console.log(`Executing: ${dropTriggerSQL}`);
                await query(dropTriggerSQL);

            } else if (diff.type === 'missing_row') {
                const columns = Object.keys(diff.row);
                const insertRowSQL = `INSERT INTO \`${diff.tableName}\` (${columns.map(col => `\`${col}\``).join(', ')}) VALUES (${columns.map(() => '?').join(', ')});`;
                console.log(`Executing: ${insertRowSQL}`, JSON.stringify(diff.row));
                await query(insertRowSQL, columns.map(col => diff.row[col]));

            }else if(diff.type === 'missing_database'){
                logger('fixing missing database', diff.database)
                const createDatabaseSQL = `CREATE DATABASE \`${diff.database}\`;`;
                console.log(`Executing: ${createDatabaseSQL}`);
                await query(createDatabaseSQL);
            } else {
                throw new Error(`Unknown difference type: ${diff.type}`);
            }
        } catch (e) {
            console.error(`Failed to apply ${describeDifference(diff)}: ${e.message}`);
            logger(diff);
            failures.push({ type: diff.type, tableName: diff.tableName, description: describeDifference(diff), message: e.message });
        }
    }

    return { attempted: differences.length, failures, warnings };
}

// One line summing up the failures from applyDifferences, for errors and logs
export const describeFailures = ({ attempted, failures }) =>
    `${failures.length} of ${attempted} difference(s) failed to apply: ${failures.map(f => `${f.description} (${f.message})`).join('; ')}`;