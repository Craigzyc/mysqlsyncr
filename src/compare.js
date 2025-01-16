import fs from 'fs/promises';
import path from 'path';
import { getDatabases, getDatabaseStructure } from './getters.js';
import { findDifferences } from './differences.js';
import { logDifferences, logger } from './loggers.js';
import { applyDifferences } from './apply.js';

export const compareAllDatabases = async (connection, inputDir, update = false, command, options) => {
    if (connection.state === 'disconnected') {
        await connection.reconnect(); // Ensure the connection is open
    }
    // Read the expected databases from the input directory
    let expectedDatabases = await fs.readdir(inputDir);
    //filter out diffs.json
    expectedDatabases = expectedDatabases.filter(file => file !== 'diffs.json');
    //filter out dumpInfo.json
    expectedDatabases = expectedDatabases.filter(file => file !== 'dumpInfo.json');
    logger('Expected databases from input directory:', expectedDatabases);

    // Check existing databases
    const existingDatabases = await getDatabases(connection);
    // console.log('Existing databases:', existingDatabases);
    const allDifferences = {};
    const missingDatabases = [];
    logger('All differences:', allDifferences);

    // Note missing databases and prepare to create them
    for (const database of expectedDatabases) {
        if(options && options.database && options.database !== database){
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
        logger('Creating missing databases:');
        for (const database of missingDatabases) {
            logger(`Creating database ${database}...`);
            await connection.query(`CREATE DATABASE \`${database}\`;`);
            logger(`Database ${database} created.`);
        }
    }else if (missingDatabases.length > 0 && !update){
        logger('Missing databases found but update is not enabled. Please enable update to create missing databases.');
        logger('Please run the command again with the --update flag to create missing databases.'); 
        logger('Missing databases:');
        logger(missingDatabases);
    } else {
        logger('All expected databases exist.');
    }

    for (const database of expectedDatabases) {
        if(options && options.database && options.database !== database){
            continue;
        }
        if(missingDatabases.includes(database)){
            logger('Skipping database', database, 'because it is missing');
            continue;
        }
        const filePath = path.join(inputDir, database, `${database}.json`);

        try {
            const fileContent = await fs.readFile(filePath, 'utf-8');
            const expectedStructure = JSON.parse(fileContent);
            logger('Getting database structure for', database);
            const currentStructure = await getDatabaseStructure(connection, database, command, options);
            logger('Database structure for', database, 'obtained');
            const differences = findDifferences(expectedStructure, currentStructure);
            logger('Differences for', database, 'obtained');
            if (!update) {
                logger('Logging differences for', database);
                logDifferences(differences, database, true);
            } else {
                logger('Logging differences for', database);
                logDifferences(differences, database, false);
                logger('Applying differences for', database);
                await applyDifferences(connection, database, differences);
            }
            allDifferences[database] = differences;
        } catch (err) {
            logger(`Error processing database ${database}:`, err.message);
        }
    }
    return allDifferences;
}