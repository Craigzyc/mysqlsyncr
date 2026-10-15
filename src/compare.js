import fs from 'fs/promises';
import path from 'path';
import { getDatabases, getDatabaseStructure } from './getters.js';
import { findDifferences } from './differences.js';
import { logDifferences, logger } from './loggers.js';
import { applyDifferences } from './apply.js';
import { loadSyncOptions, getTableOptions, applyDefinerOption } from './options.js';
import { findMissingRows } from './rows.js';

export const compareAllDatabases = async (connection, inputDir, update = false, command, options) => {
    if (connection.state === 'disconnected') {
        await connection.reconnect(); // Ensure the connection is open
    }
    // Each expected database is a folder in the input directory; files like diffs.json,
    // dumpInfo.json and syncOptions.json sit alongside them
    const entries = await fs.readdir(inputDir, { withFileTypes: true });
    const expectedDatabases = entries.filter(entry => entry.isDirectory()).map(entry => entry.name);
    const syncOptions = await loadSyncOptions(inputDir);
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
            const expectedStructure = applyDefinerOption(JSON.parse(fileContent), syncOptions.definer);
            logger('Getting database structure for', database);
            const currentStructure = await getDatabaseStructure(connection, database, command, options);
            logger('Database structure for', database, 'obtained');
            const differences = findDifferences(expectedStructure, currentStructure, (tableName) => getTableOptions(syncOptions, database, tableName));
            // A seed-row problem shouldn't hide this database's structure differences
            try {
                differences.push(...await findMissingRows(connection, database, expectedStructure, currentStructure, syncOptions));
            } catch (err) {
                console.error(`Could not check seed rows for ${database}: ${err.message}`);
            }
            logger('Differences for', database, 'obtained');
            if (!update) {
                logger('Logging differences for', database);
                logDifferences(differences, database, true);
            } else {
                logger('Logging differences for', database);
                logDifferences(differences, database, false);
                logger('Applying differences for', database);
                try {
                    await applyDifferences(connection, database, differences);
                } catch (err) {
                    console.error(`Error applying differences for ${database}: ${err.message}`);
                }
            }
            allDifferences[database] = differences;
        } catch (err) {
            console.error(`Error processing database ${database}: ${err.message}`);
        }
    }
    return allDifferences;
}