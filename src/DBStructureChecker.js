import mysql from 'mysql2';
import util from 'util';
import fs from 'fs';
import path from 'path';
import { dumpAllDatabases } from './dump.js';
import { compareAllDatabases } from './compare.js';

// The config also carries mysqlsyncr's own settings (the template folder); mysql2
// warns about options it doesn't know, so pass it only the connection's
const connectionOptions = (config) => {
    const { output, ...options } = config || {};
    return options;
}

export class DBStructureChecker {
    constructor(config, targetDatabase = null) {
        this.config = config;
        this.targetDatabase = targetDatabase;
        this.connection = mysql.createConnection(connectionOptions(this.config))
        this.dumpAllDatabases = dumpAllDatabases;
        this.compareAllDatabases = compareAllDatabases;
        this.getDatabases = () => {

            fs.readFileSync(path.join(__dirname, 'databases.json'), 'utf8');
        }
        // this.connection.on('error', (err) => {
        //     this.emit('error', err);
        //     console.error('Database connection error:', err);
        // });
        this.connection.query = util.promisify(this.connection.query); // Promisify for async/await

    }

    async reconnect() {
        this.connection = mysql.createConnection(connectionOptions(this.config));
        this.connection.query = util.promisify(this.connection.query); // Promisify for async/await
        await this.connection.connect(); // Connect to the database
    }

    async closeConnection() {
        if (this.connection.state !== 'disconnected') {
            await this.connection.end();
        }
    }


}
