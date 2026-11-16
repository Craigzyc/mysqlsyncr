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
import { checkPerformance } from './performance.js';
export { checkPerformance } from './performance.js';


const compare = async (config, output) => {
    let checker;
    let failure;
    try {
        checker = new DBStructureChecker(config);
        await checker.ready();
        const diffs = await compareAllDatabases(checker.connection, output, false, 'compare', { output, database: config.database });
        return { type: 'success', diffs };
    } catch (error) {
        failure = { type: 'error', error: error.message };
        throw failure;
    } finally {
        try { await checker?.closeConnection(); }
        catch (error) { if (!failure) throw { type: 'error', error: error.message }; failure.closeError = error.message; }
    }
}

const apply = async (config, database, diffs) => {
    let checker;
    let failure;
    try {
        checker = new DBStructureChecker(config, database);
        await checker.ready();
        const result = await applyDifferences(checker.connection, database, diffs);
        if (result.failures.length) throw Object.assign(new Error(describeFailures(result)), result);
        return { type: 'success', message: `Applied ${result.attempted} of ${result.attempted}`, warnings: result.warnings };
    } catch (error) {
        failure = { type: 'error', error: error.message, failures: error.failures, warnings: error.warnings };
        throw failure;
    } finally {
        try { await checker?.closeConnection(); }
        catch (error) { if (!failure) throw { type: 'error', error: error.message }; failure.closeError = error.message; }
    }
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
        return Boolean(process.argv[1]) && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
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
        if (!(command === 'performance' && argv.json)) console.log("MySQLsyncr started via command line")
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
                const { changes: report, notes } = await rebuildTemplate(argv.output, { write: argv.write });
                for (const [table, changes] of Object.entries(report)) {
                    console.log(`\n${table}`);
                    for (const change of changes) console.log(`  ${change}`);
                }
                const count = Object.keys(report).length;
                console.log(`\n${count} table(s) ${argv.write ? 'rebuilt' : 'would change. Run again with --write to rebuild them'}`);
                if (Object.keys(notes).length > 0) {
                    console.log('\nCheck by hand:');
                    for (const [table, note] of Object.entries(notes)) console.log(`  ${table}: ${note}`);
                }
            } catch (err) {
                console.error(err.message);
                process.exitCode = 1;
            }
        } else if (command === 'performance') {
            try {
                const report = await checkPerformance(config, argv);
                if (argv.json) console.log(JSON.stringify(report, null, 2));
                else {
                    console.log(`Performance report: ${report.database || 'all application schemas'}`);
                    for (const warning of report.warnings) console.warn(warning);
                    const icons = { ok: 'OK  ', info: 'INFO', warning: 'WARN', critical: 'CRIT', unknown: '??  ' };
                    console.log('\nHealth summary:');
                    for (const note of report.notifications || []) console.log(`  [${icons[note.status] || note.status}] ${note.area}: ${note.message}`);
                    console.log('');
                    for (const [label, rows] of [['Slow queries', report.slowQueries], ['Index review candidates', report.indexCandidates],
                        ['Highest total query time', report.highestTotalTime], ['Temporary tables and sorting', report.tempAndSortQueries],
                        ['Blocking transactions', report.diagnostics?.lockWaits?.rows || []], ['Live queries', report.diagnostics?.liveQueries?.rows || []], ['Duplicate/redundant indexes', report.duplicateIndexes || []]]) {
                        console.log(`${label}: ${rows.length}`);
                        console.table(rows);
                    }
                }
                if (!report.available) process.exitCode = 1;
            } catch (error) {
                console.error(error.message);
                process.exitCode = 1;
            }
        } else {
            // Handle other commands (dump, compare, update) as before
            console.log(`Connecting to MySQL as ${config.user}@${config.host}:${config.port}${config.password ? '' : ' with no password'}`);
            const checker = new DBStructureChecker(config, argv.database);
            try {
                await checker.ready();
                console.log('Connected to the database');
                checker.targetDatabase = argv.database;
                checker.command = command;
                checker.options = argv;
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
                        const seen = new Set();
                        for (let run = 0; run < 6; run++) {
                            const before = await compareAllDatabases(checker.connection, argv.output, true, command, argv);
                            const remaining = await compareAllDatabases(checker.connection, argv.output, false, 'compare', { ...argv, quiet: true });
                            const total = Object.values(remaining).reduce((n, diffs) => n + diffs.length, 0);
                            console.log('Remaining differences after verification:', total);
                            if (!total) break;
                            const signature = JSON.stringify(remaining);
                            if (signature === JSON.stringify(before) || seen.has(signature) || run === 5) {
                                throw new Error(`Update incomplete: ${total} difference(s) remain after verification. Review the reported differences before retrying.`);
                            }
                            seen.add(signature);
                        }
                    }
            } catch (err) {
                console.error(err.message);
                process.exitCode = 1;
            } finally {
                await checker.closeConnection();
            }
        }
    })().catch(error => { console.error(error.message); process.exitCode = 1; });
}
