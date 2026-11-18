import fs from 'fs/promises';
import path from 'path';
import { getDatabases, getDatabaseStructure } from './getters.js';
import { findDifferences } from './differences.js';
import { logDifferences } from './loggers.js';
import { applyDifferences, applyViewsAcrossDatabases, describeFailures } from './apply.js';
import { loadSyncOptions, getTableOptions, applyDefinerOption } from './options.js';
import { findMissingRows } from './rows.js';
import { getDatabaseDumpNames } from './dumpFiles.js';
import { getServerVersion, getDefaultCollations, getTemplateVersion, isLegacyTemplate } from './versions.js';

// Dependencies can cross schema boundaries. Finish each phase in ALL schemas
// before starting the next; never disable foreign-key validation to restore.
const phase = ({ type }) => {
    if (type === 'missing_database') return 0;
    if (type === 'extra_constraint') return 1;
    if (type.endsWith('_constraint')) return 3;
    if (type.endsWith('_procedure')) return 4;
    if (type.endsWith('_view')) return 5;
    if (type.endsWith('_trigger')) return 6;
    if (type === 'missing_row') return 7;
    return 2;
};

export const applyAllDifferences = async (connection, allDifferences) => {
    const result = { attempted: 0, failures: [], warnings: [] };
    for (let step = 0; step <= 7; step++) {
        if (step === 5 && Object.values(allDifferences).some(diffs => diffs.some(diff => phase(diff) === 5))) {
            const applied = await applyViewsAcrossDatabases(connection, allDifferences);
            result.attempted += applied.attempted;
            result.failures.push(...applied.failures);
            result.warnings.push(...applied.warnings);
        } else for (const [database, differences] of Object.entries(allDifferences)) {
            const batch = differences.filter(diff => phase(diff) === step);
            if (!batch.length) continue;
            const applied = await applyDifferences(connection, database, batch);
            result.attempted += applied.attempted;
            result.failures.push(...applied.failures.map(f => ({ database, ...f })));
            result.warnings.push(...applied.warnings.map(w => ({ database, ...w })));
        }
        if (result.failures.length) {
            const error = new Error(describeFailures(result));
            Object.assign(error, result, { differences: allDifferences });
            throw error;
        }
    }
    return result;
};

export const compareAllDatabases = async (connection, inputDir, update = false, command, options = {}) => {
    const names = await getDatabaseDumpNames(inputDir);
    const databases = names.filter(name => !options.database || options.database === name);
    if (!databases.length) throw new Error(options.database
        ? `Database ${options.database} is not in the template.`
        : 'No database manifests found in the template folder.');
    const syncOptions = await loadSyncOptions(inputDir);
    const expected = {};
    // A corrupt/empty manifest must never look like an empty desired schema.
    // Validate ALL files before the first mutation, including missing databases.
    for (const database of databases) {
        const filename = path.join(inputDir, database, `${database}.json`);
        const structure = JSON.parse(await fs.readFile(filename, 'utf8'));
        if (!structure || typeof structure !== 'object' || !structure.tables || Array.isArray(structure.tables)
            || typeof structure.tables !== 'object') throw new Error(`Invalid template manifest: ${filename}`);
        expected[database] = applyDefinerOption(structure, syncOptions.definer);
    }
    const existing = await getDatabases(connection);
    const templateVersion = (await getTemplateVersion(inputDir))?.version;
    // A missing schema needs no live metadata, except that a 5.7 template's
    // CREATE TABLE is pinned to its collations for an 8.0 server.
    const serverVersion = databases.some(db => existing.includes(db)) || update || isLegacyTemplate(templateVersion) ? await getServerVersion(connection) : null;
    const defaultCollations = serverVersion ? await getDefaultCollations(connection, serverVersion) : {};
    const allDifferences = {};
    for (const database of databases) {
        const missing = !existing.includes(database);
        const current = missing ? { tables: {}, procedures: [], views: {} }
            : await getDatabaseStructure(connection, database, 'compare', { ...options, output: inputDir });
        const differences = missing ? [{ database, type: 'missing_database', message: 'Database not found' }] : [];
        differences.push(...findDifferences(expected[database], current,
            table => getTableOptions(syncOptions, database, table), { serverVersion, database, defaultCollations, templateVersion }));
        differences.push(...await findMissingRows(connection, database, expected[database], current, syncOptions));
        allDifferences[database] = differences;
        if (!options.quiet) logDifferences(differences, database, !update);
    }
    if (update) {
        await applyAllDifferences(connection, allDifferences);
    }
    return allDifferences;
};
