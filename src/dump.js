import fs from 'fs/promises';
import path from 'path';
import { getDatabases, getDatabaseStructure } from './getters.js';

export const dumpAllDatabases = async (connection, command, options) => {
    const databases = await getDatabases(connection);
    for (const database of databases) {
        let dbStructure = await getDatabaseStructure(connection, database, command, options);
        await fs.writeFile(path.join(options.output, database, `${database}.json`), JSON.stringify(dbStructure, null, 4), 'utf-8');
    }
}

