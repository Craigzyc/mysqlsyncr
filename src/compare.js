import fs from 'fs/promises';
import path from 'path';
import { getDatabases, getDatabaseStructure } from './getters.js';
import { findDifferences } from './differences.js';
import { logDifferences } from './loggers.js';
import { applyDifferences } from './apply.js';

export const compareAllDatabases = async (connection, inputDir, update = false, command, options) => {
    if (connection.state === 'disconnected') {
        await connection.reconnect(); // Ensure the connection is open
    }
    // Read the expected databases from the input directory
    const expectedDatabases = await fs.readdir(inputDir);
    // console.log('Expected databases from input directory:', expectedDatabases);

    // Check existing databases
    const existingDatabases = await getDatabases(connection);
    // console.log('Existing databases:', existingDatabases);
    const allDifferences = {};
    const missingDatabases = [];
    console.log('All differences:', allDifferences);

    // Note missing databases and prepare to create them
    for (const database of expectedDatabases) {
        if(options.database && options.database !== database){
            continue;
        }

        if (!existingDatabases.includes(database)) {
            allDifferences[database] = [{
                database: database,
                type: 'missing_database',
                message: 'Database not found'
            }];
            missingDatabases.push(database);
        }
    }

    // Create missing databases at the beginning
    if (missingDatabases.length > 0 && update) {
        console.log('Creating missing databases:');
        for (const database of missingDatabases) {
            console.log(`Creating database ${database}...`);
            await connection.query(`CREATE DATABASE \`${database}\`;`);
            console.log(`Database ${database} created.`);
        }
    }else if (missingDatabases.length > 0 && !update){
        console.error('Missing databases found but update is not enabled. Please enable update to create missing databases.');
        console.error('Please run the command again with the --update flag to create missing databases.'); 
        console.error('Missing databases:');
        console.error(missingDatabases);
    } else {
        console.log('All expected databases exist.');
    }

    for (const database of expectedDatabases) {
        if(options.database && options.database !== database){
            continue;
        }
        const filePath = path.join(inputDir, database, `${database}.json`);
        try {
            const fileContent = await fs.readFile(filePath, 'utf-8');
            const expectedStructure = JSON.parse(fileContent);
            console.log('Getting database structure for', database);
            const currentStructure = await getDatabaseStructure(connection, database, command, options);
            console.log('Database structure for', database, 'obtained');
            const differences = findDifferences(expectedStructure, currentStructure);
            console.log('Differences for', database, 'obtained');
            if (!update) {
                console.log('Logging differences for', database);
                logDifferences(differences, database, true);
            } else {
                console.log('Logging differences for', database);
                logDifferences(differences, database, false);
                console.log('Applying differences for', database);
                await applyDifferences(connection, database, differences);
            }
            allDifferences[database] = differences;
        } catch (err) {
            console.error(`Error processing database ${database}:`, err.message);
        }
    }
    return allDifferences;
}