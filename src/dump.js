import fs from 'fs/promises';
import path from 'path';
import { getDatabases, getDatabaseStructure } from './getters.js';
import { logger } from './loggers.js';
import { loadSyncOptions, OPTIONS_FILE } from './options.js';
import { assertOutsidePackage } from './paths.js';
import { getServerVersion } from './versions.js';

// const require = createRequire(import.meta.url);
// const { version } = require('../package.json');

export const dumpAllDatabases = async (connection, command, options) => {
    let response = {}
    assertOutsidePackage(options.output);
    const databases = await getDatabases(connection);
    const syncOptions = await loadSyncOptions(options.output);
    for (const database of databases) {
        let dbStructure = await getDatabaseStructure(connection, database, command, options, syncOptions);
        if(Object.keys(dbStructure.views).length === 0){
            delete dbStructure.views
        }
        if(Object.keys(dbStructure.procedures).length === 0){
            delete dbStructure.procedures
        }
        // A database without tables has no folder yet
        await fs.mkdir(path.join(options.output, database), { recursive: true });
        await fs.writeFile(path.join(options.output , database, `${database}.json`), JSON.stringify(dbStructure, null, 4), 'utf-8');
        response[database] = dbStructure;
    }

    // The MySQL version lets compare explain differences that are only how another version prints SQL
    const mysqlVersion = await getServerVersion(connection);
    await fs.writeFile(path.join(options.output, 'dumpInfo.json'), JSON.stringify({ timestamp: new Date().toISOString(), mysqlVersion }, null, 4), 'utf-8');
    return response;
}

export const getDatabasesFromExistingDumps = async (options) => {
    logger('Getting databases from existing dumps in ', options.output);
    //check if the folder exists
    let exists = await fs.stat(options.output).catch(() => false);
    if (!exists) {
        logger('Folder does not exist');
        return {};
    }   
    //read directory above to get the dbs. each db is in a named folder with a matching .json. 

    //combine all the .jsons into a single object
    let response = {}
    const databases = await fs.readdir(path.join(options.output));
    for (const database of databases) {
        if(database.includes('diffs') || database.includes('dumpInfo') || database === OPTIONS_FILE){
            logger('Skipping diffs folder')
            continue
        }
        let dbStructure = await fs.readFile(path.join(options.output, database, `${database}.json`), 'utf8');
        response[database] = JSON.parse(dbStructure);
    }
    return response;
}




