#!/usr/bin/env node

import { cli } from './cli.js';
import { DBStructureChecker } from './DBStructureChecker.js';
import { dumpAllDatabases, getDatabasesFromExistingDumps } from './dump.js';
import { compareAllDatabases } from './compare.js';
import { applyDifferences, describeFailures } from './apply.js';
import { startApiServer } from './socketServer.js'; // Import the new socket server
import { rebuildTemplate } from './rebuild.js';
import { assertOutsidePackage, templateFolderProblem } from './paths.js';
import { getVersionInfo } from './versions.js';
import { acceptCurrentIntoTemplate } from './acceptCurrent.js';
import open from 'open';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'node:url';


const compare = async (config, output) => {
    return new Promise(async (resolve, reject) => {
        let checker
        try {
            checker = new DBStructureChecker(config);
            // Without this a refused connection is an unhandled 'error' event and the promise never settles
            checker.connection.on('error', (err) => {
                reject({ type: 'error', error: err.message });
            });
            checker.connection.on('connect', async () => {
                try {
                    const diffs = await compareAllDatabases(checker.connection, output, false, 'compare', { output: output });
                    resolve({ type: 'success', diffs });
                } catch (e) {
                    // e.g. an invalid syncOptions.json
                    reject({ type: 'error', error: e.message });
                } finally {
                    await checker.closeConnection();
                }
            });
        } catch (e) {
            reject({ type: 'error', error: e.message });
            if (checker) await checker.closeConnection();
        }
    });
}

const apply = async (config, database, diffs) => {
    return new Promise((resolve, reject) => {
        let checker;
        try {
            checker = new DBStructureChecker(config, database);

            checker.connection.on('error', async (err) => {
                console.error('Database connection error in route apply:', err);
                reject({ type: 'error', error: err.message });
                await checker.closeConnection();
            });

            checker.connection.on('connect', async () => {
                console.log('Connected to the database');
                checker.targetDatabase = database;
                checker.command = 'apply';
                checker.options = { config, database, diffs };
                try {
                    console.log('Applying the database structure based on JSON dumps');
                    const result = await applyDifferences(checker.connection, database, diffs);
                    if (result.failures.length > 0) {
                        // Callers treat a resolved apply as done, so anything that failed rejects
                        reject({ type: 'error', error: describeFailures(result), failures: result.failures, warnings: result.warnings });
                    } else {
                        resolve({ type: 'success', message: `Applied ${result.attempted} of ${result.attempted}`, warnings: result.warnings });
                    }
                    await checker.closeConnection();
                } catch (err) {
                    reject({ type: 'error', error: err.message });
                    await checker.closeConnection();
                }
            });
        } catch (e) {
            reject({ type: 'error', error: e.message });
        }
    });
}

export { DBStructureChecker, dumpAllDatabases, compare, startApiServer, apply, getDatabasesFromExistingDumps, rebuildTemplate, acceptCurrentIntoTemplate };

// Show which MySQL versions are being compared, and what that means
const printVersions = async (connection, templateDir) => {
    const { server, template, notes } = await getVersionInfo(connection, templateDir);
    const templateText = template
        ? `${template.version}${template.inferred ? ` (inferred: ${template.reason})` : ''}`
        : 'unknown';
    console.log(`MySQL server: ${server ?? 'unknown'}; template: ${templateText}`);
    for (const note of notes) console.log(`  Note: ${note}`);
}

// Only run this if this is the main module
const isMain = (() => {
    // CommonJS build (dist/index.cjs, the mysqlsyncr bin)
    if (typeof require !== 'undefined' && typeof module !== 'undefined') {
        return require.main === module;
    }
    // ES module (node src/index.js): compare real paths, since the bin may be a symlink
    try {
        return !!process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url));
    } catch (e) {
        return false;
    }
})();

if (isMain) {
    (async () => {
        const { command, config, argv } = await cli();
        if (!command) {
            process.exitCode = 1;
            return;
        }
        // dump writes the template, compare writes diffs.json and rebuild --write rewrites the template
        if (command === 'dump' || command === 'compare' || (command === 'rebuild' && argv.write)) {
            try {
                assertOutsidePackage(argv.output);
            } catch (err) {
                console.error(err.message);
                process.exitCode = 1;
                return;
            }
        }
        // compare, update and rebuild read an existing template; an empty folder would compare nothing
        if (command === 'compare' || command === 'update' || command === 'rebuild') {
            const problem = templateFolderProblem(argv.output);
            if (problem) {
                console.error(`Template folder: ${problem}`);
                process.exitCode = 1;
                return;
            }
        }
        if (command === 'dump' && !fs.existsSync(argv.output)) {
            fs.mkdirSync(argv.output, { recursive: true });
            console.log(`Created ${path.resolve(argv.output)}`);
        }
        console.log("MySQLsyncr started via command line")
        if (command === 'ui') {
            const PORT = argv.uiPort
            startApiServer(PORT, argv); // Start the Socket.IO server
            console.log('Server started on port', PORT);
            console.log('Open http://localhost:' + PORT + ' in your browser to use the UI');
            if (argv.openUI && argv.openUI === true || argv.openUI === 'true') {
                await open(`http://localhost:${PORT}`);
            }
        } else if (command === 'rebuild') {
            // Works on the files only; no database connection needed
            try {
                const report = await rebuildTemplate(argv.output, { write: argv.write });
                for (const [table, changes] of Object.entries(report)) {
                    console.log(`\n${table}`);
                    for (const change of changes) console.log(`  ${change}`);
                }
                const count = Object.keys(report).length;
                console.log(`\n${count} table(s) ${argv.write ? 'rebuilt' : 'would change. Run again with --write to rebuild them'}`);
            } catch (err) {
                console.error(err.message);
                process.exitCode = 1;
            }
        } else {
            // Handle other commands (dump, compare, update) as before
            console.log(`Connecting to MySQL as ${config.user}@${config.host}:${config.port}${config.password ? '' : ' with no password'}`);
            const checker = new DBStructureChecker(config, argv.database);
            checker.connection.on('error', (err) => {
                console.error(`MySQL connection error (${config.user}@${config.host}:${config.port}): ${err.message}`);
                if (err.code === 'ER_ACCESS_DENIED_ERROR') {
                    // e.g. 'root'@'172.17.0.1' when MySQL runs in Docker
                    console.error(`The user and password were rejected. The address in MySQL's message is where the server saw the connection come from, not the host connected to.`);
                }
                process.exitCode = 1;
            });
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
                        await printVersions(checker.connection, argv.output);
                        console.log('Comparing the database structure with JSON dumps (dry run)');
                        let diffs = await compareAllDatabases(checker.connection, argv.output, false, command, argv); // Dry run
                        let totalDiffs = Object.values(diffs).reduce((acc, arr) => acc + arr.length, 0);
                        console.log('Total differences count:', totalDiffs);
                        fs.writeFileSync(path.join(argv.output, 'diffs.json'), JSON.stringify(diffs, null, 4));
                    } else if (command === 'update') {
                        await printVersions(checker.connection, argv.output);
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
                            if (totalDiffs > 0 && runCount < maxRuns) {
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
}
