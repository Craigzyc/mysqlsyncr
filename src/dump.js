import fs from 'fs/promises';
import path from 'path';
import { getDatabases, getDatabaseStructure } from './getters.js';
import { logger } from './loggers.js';

// const require = createRequire(import.meta.url);
// const { version } = require('../package.json');

export const dumpAllDatabases = async (connection, command, options) => {
    let response = {}
    const databases = await getDatabases(connection);
    for (const database of databases) {
        let dbStructure = await getDatabaseStructure(connection, database, command, options);
        if(Object.keys(dbStructure.views).length === 0){
            delete dbStructure.views
        }
        if(Object.keys(dbStructure.procedures).length === 0){
            delete dbStructure.procedures
        }
        await fs.writeFile(path.join(options.output , database, `${database}.json`), JSON.stringify(dbStructure, null, 4), 'utf-8');
        response[database] = dbStructure;
    }

    await fs.writeFile(path.join(options.output, 'dumpInfo.json'), JSON.stringify({timestamp: new Date().toISOString()}, null, 4), 'utf-8');
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
        if(database.includes('diffs') || database.includes('dumpInfo')){
            logger('Skipping diffs folder')
            continue
        }
        let dbStructure = await fs.readFile(path.join(options.output, database, `${database}.json`), 'utf8');
        response[database] = JSON.parse(dbStructure);
    }
    return response;
}




