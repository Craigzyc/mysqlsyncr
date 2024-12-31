#!/usr/bin/env node

import mysql from 'mysql2';
import util from 'util';
import fs from 'fs';
import path from 'path';
import { cli } from './cli.js';
import { dumpAllDatabases } from './dump.js';
import { compareAllDatabases } from './compare.js';
import { startApiServer } from './socketServer.js'; // Import the new socket server
import open from 'open';

class DBStructureChecker {
    constructor(config, targetDatabase = null) {
        this.config = config;
        this.targetDatabase = targetDatabase;
        this.connection = mysql.createConnection(this.config)
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
        this.connection = mysql.createConnection(this.config);
        this.connection.query = util.promisify(this.connection.query); // Promisify for async/await
        await this.connection.connect(); // Connect to the database
    }

    async closeConnection() {
        if (this.connection.state !== 'disconnected') {
            await this.connection.end();
        }
    }


}

// Export the DBStructureChecker class
export { DBStructureChecker };

// Start the server only if the 'ui' command is used
const PORT = process.env.PORT || 3000;
(async () => {
    const { command, config, argv } = cli();

    if (command === 'ui') {
        startApiServer(PORT); // Start the Socket.IO server
        console.log('Server started on port', PORT);
        console.log('Open http://localhost:' + PORT + ' in your browser to use the UI');
        await open(`http://localhost:${PORT}`);
    } else {
        // Handle other commands (dump, compare, update) as before
        const checker = new DBStructureChecker(config, argv.database);
        checker.connection.on('connect', async () => {
            console.log('Connected to the database');
            checker.targetDatabase = argv.database;
            checker.command = command;
            checker.options = argv;
            try {
                if (command === 'dump') {
                    console.log('Dumping the database structure to files');
                    await dumpAllDatabases(checker.connection, command, argv);
                } else if (command === 'compare') {
                    console.log('Comparing the database structure with JSON dumps (dry run)');
                    let diffs = await compareAllDatabases(checker.connection, argv.output, false, command, argv); // Dry run
                    let totalDiffs = Object.values(diffs).reduce((acc, arr) => acc + arr.length, 0);
                    console.log('Total differences count:', totalDiffs);
                    fs.writeFileSync(path.join(argv.output, 'diffs.json'), JSON.stringify(diffs, null, 4));
                } else if (command === 'update') {
                    console.log('Updating the database structure based on JSON dumps');
                    let totalDiffs = Infinity; // Initialize with a large number
                    let previousDiffs = totalDiffs; // Store previous differences
                    let runCount = 0; // Counter for the number of runs
                    let maxRuns = 6;
                    while (runCount < maxRuns && totalDiffs > 0 && (totalDiffs < previousDiffs || previousDiffs === Infinity)) {
                        console.log('Running update command. Run count:', runCount);
                        let diffs = await compareAllDatabases(checker.connection, argv.output, true, command, argv); // Apply updates
                        previousDiffs = totalDiffs; // Update previous differences
                        totalDiffs = Object.values(diffs).reduce((acc, arr) => acc + arr.length, 0);
                        console.log('Total differences count:', totalDiffs);
                        runCount++;
                        if(totalDiffs > 0 && runCount < maxRuns){
                            console.log('Total differences count is still greater than 0. Waiting 1 second before next run. Run count:', runCount);
                            await new Promise(resolve => setTimeout(resolve, 1000));
                        }
                    }
                }
            } catch (err) {
                console.error(err.message);
            } finally {
                await checker.closeConnection();
            }
        });
    }
})();
