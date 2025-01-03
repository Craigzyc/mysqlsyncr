import { logger } from './loggers.js';

export const applyDifferences = async (connection, database, differences) => {
   
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
                logger(`Executing: ${createDatabaseSQL}`);
                await connection.query(createDatabaseSQL);
                continue;
            }


            await connection.query(`USE \`${database}\``);
            if (diff.type === 'missing_table') {
                const { tableName, createSQL } = diff;
                logger(`Creating missing table ${tableName}`);
                logger(`Executing: ${createSQL}`);
                await connection.query(createSQL);

            } else if (diff.type === 'extra_table') {
                const { tableName } = diff;
                logger(`Dropping extra table ${tableName}`);
                const dropTableSQL = `DROP TABLE \`${tableName}\`;`;
                logger(`Executing: ${dropTableSQL}`);
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
                logger(`Executing: ${dropFieldSQL}`);
                await connection.query(dropFieldSQL);

            } else if (diff.type === 'mismatched_field') {
                const { tableName, field } = diff;
                const defaultClause = field.Default === 'CURRENT_TIMESTAMP' 
                    ? 'DEFAULT CURRENT_TIMESTAMP'
                    : field.Default !== undefined && field.Default !== null 
                        ? `DEFAULT '${field.Default}'` 
                        : '';
                
                const dropFieldSQL = `ALTER TABLE \`${tableName}\` CHANGE \`${field.Field}\` \`${field.Field}\` ${field.Type} ${field.NotNull ? 'NOT NULL' : ''} ${defaultClause};`;
                logger(`Executing: ${dropFieldSQL}`);
                await connection.query(dropFieldSQL);

            } else if (diff.type === 'missing_index') {
                const existingColumns = await connection.query(`SHOW COLUMNS FROM \`${diff.tableName}\``);
                const columnNames = existingColumns.map(col => col.Field);

                // Check if all columns for the index exist
                const missingColumns = Array.isArray(diff.index.ColumnName) ? diff.index.ColumnName.filter(col => !columnNames.includes(col)) : [];

                if (missingColumns.length > 0) {
                    logger(`Cannot create index ${diff.index.Name} on ${diff.tableName}. Missing columns: ${missingColumns.join(', ')}`);
                    continue; // Skip index creation if columns are missing
                }

                // Prepare the index columns with proper formatting
                const indexColumns = diff.index.ColumnName.map(col => `\`${col}\``); // Format column names

                // Handle PRIMARY index creation
                if (diff.index.Name === 'PRIMARY') {
                    if (indexColumns.length > 0) {
                        const primaryKeySQL = `ALTER TABLE \`${diff.tableName}\` ADD PRIMARY KEY (${indexColumns.join(', ')});`;
                        logger(`Executing: ${primaryKeySQL}`);
                        await connection.query(primaryKeySQL);
                    } else {
                        logger(`Cannot create PRIMARY index on ${diff.tableName}. ColumnName is undefined or empty.`, diff.index);
                    }
                } else {
                    // Create the new index with UNIQUE if applicable
                    const uniqueSQL = diff.index.Unique ? 'UNIQUE ' : ''; // Check if the index is unique
                    if (indexColumns.length > 0) {
                        const addIndexSQL = `ALTER TABLE \`${diff.tableName}\` ADD ${uniqueSQL}INDEX \`${diff.index.Name}\` (${indexColumns.join(', ')});`;
                        logger(`Executing: ${addIndexSQL}`);
                        await connection.query(addIndexSQL);
                    } else {
                        logger(`Cannot create index ${diff.index.Name} on ${diff.tableName}. ColumnName is undefined or empty.`, diff.index);
                    }
                }

            } else if (diff.type === 'extra_index') {
                // Handle dropping of extra indexes
                if (diff.index.Name === 'PRIMARY') {
                    const dropPrimaryKeySQL = `ALTER TABLE \`${diff.tableName}\` DROP PRIMARY KEY;`;
                    logger(`Executing: ${dropPrimaryKeySQL}`);
                    await connection.query(dropPrimaryKeySQL);
                } else {
                    const dropIndexSQL = `DROP INDEX \`${diff.index.Name}\` ON \`${diff.tableName}\`;`;
                    logger(`Executing: ${dropIndexSQL}`);
                    await connection.query(dropIndexSQL);
                }

            } else if (diff.type === 'mismatched_index') {
                const { tableName, index } = diff;
                // Drop the existing index
                if (index.Name === 'PRIMARY') {
                    const dropPrimaryKeySQL = `ALTER TABLE \`${tableName}\` DROP PRIMARY KEY;`;
                    logger(`Executing: ${dropPrimaryKeySQL}`);
                    await connection.query(dropPrimaryKeySQL);
                } else {
                    const dropIndexSQL = `DROP INDEX \`${index.Name}\` ON \`${tableName}\`;`;
                    logger(`Executing: ${dropIndexSQL}`);
                    await connection.query(dropIndexSQL);
                }
                console.log('index', index)

                // Create the new index
                const uniqueSQL = index.Unique ? 'UNIQUE ' : ''; // Check if the index is unique
                if (index.Name === 'PRIMARY') {
                    const addPrimaryKeySQL = `ALTER TABLE \`${tableName}\` ADD PRIMARY KEY (${index.ColumnName.join(', ')});`;
                    logger(`Executing: ${addPrimaryKeySQL}`);
                    await connection.query(addPrimaryKeySQL);
                } else {
                    const addIndexSQL = `ALTER TABLE \`${tableName}\` ADD ${uniqueSQL}INDEX \`${index.Name}\` (${index.ColumnName.join(', ')});`; // Include UNIQUE if applicable
                    logger(`Executing: ${addIndexSQL}`);
                    await connection.query(addIndexSQL);
                }

            } else if (diff.type === 'missing_procedure' || diff.type === 'mismatched_procedure') {

                // Drop the procedure if it exists
                const dropCurrentProcSQL = `DROP PROCEDURE IF EXISTS \`${diff.Name}\`;`;
                logger(`Executing: ${dropCurrentProcSQL}`);
                await connection.query(dropCurrentProcSQL);

                // Create the procedure
                const createProcSQL = diff.Definition;
                logger(`Executing: ${createProcSQL}`); // Log the SQL statement
                await connection.query(createProcSQL);



            } else if (diff.type === 'missing_view') {
                const dropViewSQL = `DROP VIEW IF EXISTS \`${diff.viewName}\`;`;
                logger(`Executing: ${dropViewSQL}`);
                await connection.query(dropViewSQL);
                const createViewSQL = diff.definition; // Use the expected definition to create the view
                logger(`Executing: ${createViewSQL}`);
                await connection.query(createViewSQL);


            } else if (diff.type === 'mismatched_view') {
                const dropViewSQL = `DROP VIEW IF EXISTS \`${diff.viewName}\`;`;
                logger(`Executing: ${dropViewSQL}`);
                await connection.query(dropViewSQL);
                const createViewSQL = diff.definition; // Use the expected definition to create the view
                logger(`Executing: ${createViewSQL}`);
                await connection.query(createViewSQL);


            } else if (diff.type === 'extra_view') {
                const dropViewSQL = `DROP VIEW IF EXISTS \`${diff.viewName}\`;`;
                logger(`Executing: ${dropViewSQL}`);
                await connection.query(dropViewSQL);


            } else if (diff.type === 'missing_trigger') {
                const createTriggerSQL = diff.trigger.Definition;
                console.log('fixing trigger', diff.trigger.Name)
                console.log(`Executing: ${createTriggerSQL}`);
                await connection.query(createTriggerSQL);


            } else if (diff.type === 'mismatched_trigger') {
                const dropTriggerSQL = `DROP TRIGGER IF EXISTS \`${diff.trigger.Name}\`;`;
                logger(`Executing: ${dropTriggerSQL}`);
                await connection.query(dropTriggerSQL);
                const createTriggerSQL = diff.trigger.Definition;
                console.log(`Executing: ${createTriggerSQL}`);
                await connection.query(createTriggerSQL);


            } else if (diff.type === 'extra_trigger') {
                const dropTriggerSQL = `DROP TRIGGER IF EXISTS \`${diff.trigger.Name}\`;`;
                logger(`Executing: ${dropTriggerSQL}`);
                await connection.query(dropTriggerSQL);

            }else if(diff.type === 'missing_database'){
                console.log('fixing missing database', diff.database)
                const createDatabaseSQL = `CREATE DATABASE \`${diff.database}\`;`;
                logger(`Executing: ${createDatabaseSQL}`);
                await connection.query(createDatabaseSQL);
            } else {
                logger(`Error applying difference of type:${diff.type}`, diff)
            }
        } catch (e) {
            logger(`Error applying difference of type:${diff.type}. Error: ${e.message}`, diff);
        }
    }
}