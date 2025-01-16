import { parseCreateTableSQL } from './parsers.js';
import path from 'path';
import fs from 'fs/promises';
import { logger } from './loggers.js';

export const getDatabases = async (connection) => {
    const databases = await connection.query('SHOW DATABASES');
    return databases
        .map(db => db.Database)
        .filter(db => !['information_schema', 'mysql', 'performance_schema', 'sys'].includes(db));
}


export const getDatabaseStructure = async (connection, database, command, options) => {
    if (connection.state === 'disconnected') {
        await connection.reconnect(); // Ensure the connection is open
    }
    await connection.query(`USE \`${database}\``); // Switch to the target database
    const tables = {};
    const procedures = [];
    const views = {};
    const dbDir = path.join(options.output, database); // Use argv.output for the base path

    // Create the output directory for the database if it doesn't exist
    if (command === 'dump') {
        const tableDir = path.join(dbDir, 'tables'); // Subfolder for table SQL files
        await fs.mkdir(tableDir, { recursive: true }); // Create the tables directory
    }

    // Get tables and their structures
    const tableRows = await connection.query('SHOW FULL TABLES WHERE Table_Type != "VIEW"');


    for (const row of tableRows) {
        const tableName = Object.values(row)[0]; // Get the first value in the row object
        if (!tableName) {
            logger(`Undefined table name found in database ${database}`, row);
            continue; // Skip undefined table names
        }

        // Get the CREATE TABLE statement
        const createTableRow = await connection.query(`SHOW CREATE TABLE \`${tableName}\``);
        const createTableSQL = createTableRow[0]['Create Table'];

        const parsedTable = parseCreateTableSQL(createTableSQL);

        // Structure the table object
        tables[tableName] = {
            columns: parsedTable.columns, // Array of columns
            indexes: parsedTable.indexes,   // Array of indexes
            constraints: parsedTable.constraints, // Array of constraints
            triggers: [],                   // Initialize triggers array
            createSQL: createTableSQL       // Store the CREATE TABLE SQL if needed
        };

        // Save the CREATE TABLE statement to an individual SQL file for each table
        if (command === 'dump') {
            const tableDir = path.join(dbDir, 'tables'); // Subfolder for table SQL files
            const filePath = path.join(tableDir, `${tableName}.sql`); // Use the table directory for file saving
            await fs.mkdir(path.dirname(filePath), { recursive: true }); // Create the tables directory if it doesn't exist
            await fs.writeFile(filePath, `${createTableSQL}\n`, 'utf-8');
            logger(`Table structure saved to: ${filePath}`);
        }
    }

    // Get stored procedures
    const routineRows = await connection.query(`SHOW PROCEDURE STATUS WHERE Db = ?`, [database]);

    for (const row of routineRows) {
        let createSQLrow = await connection.query(`SHOW CREATE PROCEDURE \`${row.Name}\``);
        let createSQL = createSQLrow[0]['Create Procedure'];
        procedures.push({
            Name: row.Name,
            Definition: createSQL
        }); // Add procedure names to the array
        if (command === 'dump') {
            const filePath = path.join(dbDir, 'procedures', `${row.Name}.sql`); // Use the table directory for file saving
            await fs.mkdir(path.dirname(filePath), { recursive: true }); // Create the procedures directory if it doesn't exist
            await fs.writeFile(filePath, `${createSQL}\n`, 'utf-8');
            logger(`Procedure definition saved to: ${filePath}`);
        }
    }

    // Get triggers
    const triggerRows = await connection.query(`
        SELECT TRIGGER_NAME, EVENT_OBJECT_TABLE
        FROM INFORMATION_SCHEMA.TRIGGERS
        WHERE TRIGGER_SCHEMA = ?
    `, [database]);

    for (const row of triggerRows) {
        const triggerName = row.TRIGGER_NAME;
        const tableName = row.EVENT_OBJECT_TABLE;

        // Ensure triggerDefinition is defined before using it
        const triggerDefinitionRow = await connection.query(`SHOW CREATE TRIGGER \`${triggerName}\``);
        const triggerDefinition = triggerDefinitionRow[0]['SQL Original Statement'];

        if (triggerDefinition) {

            tables[tableName].triggers.push({
                Name: triggerName,
                Definition: triggerDefinition
            });
            if (command === 'dump') {
                const tableDir = path.join(dbDir, 'tables'); // Subfolder for table SQL files
                const triggerFilePath = path.join(tableDir, 'triggers', `${triggerName}.sql`);
                await fs.mkdir(path.dirname(triggerFilePath), { recursive: true }); // Create the triggers directory if it doesn't exist
                await fs.writeFile(triggerFilePath, `${triggerDefinition}\n`, 'utf-8');
                logger(`Trigger definition saved to: ${triggerFilePath}`);
            }

        } else {
            logger(`Trigger ${triggerName} has no action statement.`);
        }
    }

    // Get views
    const viewRows = await connection.query(`SHOW FULL TABLES IN \`${database}\` WHERE TABLE_TYPE LIKE 'VIEW'`);
    for (const row of viewRows) {
        let viewName = row[`Tables_in_${database.toLowerCase()}`];
        if (!viewName) viewName = row[`Tables_in_${database}`];
        logger(`getting view Tables_in_${database}`, viewName);
        try {
            const viewDefinition = await connection.query(`SHOW CREATE VIEW \`${viewName}\``);
            views[viewName] = viewDefinition[0]['Create View'];
            if (command === 'dump') {
                const filePath = path.join(dbDir, 'views', `${viewName}.sql`); // Use the table directory for file saving
                await fs.mkdir(path.dirname(filePath), { recursive: true }); // Create the views directory if it doesn't exist
                await fs.writeFile(filePath, `${viewDefinition[0]['Create View']}\n`, 'utf-8');
                logger(`View definition saved to: ${filePath}`);
            }
        } catch (error) {
            logger(`Error retrieving definition for view ${viewName}:`, error.message);
            logger(row)
        }
    }

    return { tables, procedures, views };
}