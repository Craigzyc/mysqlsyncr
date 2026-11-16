import express from 'express';
import http from 'http';
import { join, resolve } from 'path';
import { readdir, mkdir } from 'fs/promises';
import { dumpAllDatabases, getDatabasesFromExistingDumps } from './dump.js';
import { compareAllDatabases, applyAllDifferences } from './compare.js';
import { DBStructureChecker } from './DBStructureChecker.js';
import { applyDifferences } from './apply.js';
import { packageRoot, assertOutsidePackage } from './paths.js';
import { acceptCurrentIntoTemplate } from './acceptCurrent.js';
import { getVersionInfo } from './versions.js';
import { findTemplateDrift, resolveTemplateDrift } from './templateDrift.js';
import { checkPerformance } from './performance.js';
import { analyzePerformanceQuery, getAiStatus } from './aiAnalysis.js';

export const setConfig = (input = {}, argv = {}) => {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('config must be an object.');
    const config = { ...input };
    for (const key of ['host', 'port', 'user', 'password', 'database', 'output']) {
        if (config[key] == null && argv[key] != null) config[key] = argv[key];
    }
    return config;
};

const withDatabase = async (config, action) => {
    const checker = new DBStructureChecker(config);
    let operationError;
    try {
        await checker.ready();
        return await action(checker.connection);
    } catch (error) {
        operationError = error;
        throw error;
    } finally {
        try { await checker.closeConnection(); }
        catch (error) { if (!operationError) throw error; operationError.closeError = error.message; }
    }
};

export const startApiServer = (port, argv = {}) => {
    const app = express();
    const server = http.createServer(app);
    // A web page must not borrow this local tool's startup DB credentials.
    // Non-browser clients omit Origin; browser clients must use this UI origin.
    app.use('/api', (req, res, next) => {
        const localOnly = !argv.uiHost || ['127.0.0.1', 'localhost', '::1'].includes(argv.uiHost);
        if (localOnly && !['127.0.0.1', 'localhost', '[::1]', '::1'].includes(req.hostname)) {
            return res.status(403).json({ message: 'Use a loopback hostname to access this local mysqlsyncr server.' });
        }
        const origin = req.get('origin');
        if (origin) {
            const sameOrigin = origin === `${req.protocol}://${req.get('host')}`;
            if (!sameOrigin) return res.status(403).json({ message: 'Use the mysqlsyncr UI on this server to access its API.' });
        }
        next();
    });
    app.use(express.json({ limit: '50mb' }));
    app.use(express.urlencoded({ limit: '50mb', extended: true }));
    app.use('/api', (req, res, next) => {
        if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
            return res.status(400).json({ message: 'Request body must be an object.' });
        }
        if ('config' in (req.body || {}) && (!req.body.config || typeof req.body.config !== 'object' || Array.isArray(req.body.config))) {
            return res.status(400).json({ message: 'config must be an object.' });
        }
        if (['/apply', '/acceptCurrent'].includes(req.path)
            && (typeof req.body.database !== 'string' || !req.body.database || !Array.isArray(req.body.diffs)
                || req.body.diffs.some(d => !d || typeof d.type !== 'string'))) {
            return res.status(400).json({ message: 'database and an array of diffs are required.' });
        }
        if (['/apply', '/acceptCurrent'].includes(req.path)
            && req.body.diffs.some(diff => diff.type === 'missing_database' && diff.database !== req.body.database)) {
            return res.status(400).json({ message: 'A missing_database difference must match its database scope.' });
        }
        next();
    });
    console.log(`Serving UI from ${join(packageRoot, 'ui/dist/spa')}`);
    app.use(express.static(join(packageRoot, 'ui/dist/spa')));
    const configFor = body => {
        const config = setConfig(body.config, argv);
        if (body.database !== undefined) config.database = body.database;
        return config;
    };
    // Express 4 does not forward rejected async route promises automatically.
    const post = (url, action) => app.post(url, (req, res, next) => {
        Promise.resolve().then(() => action(req.body || {})).then(result => res.json(result), next);
    });
    const badRequest = message => Object.assign(new Error(message), { status: 400 });

    post('/api/getDatabasesFromExistingDumps', body => getDatabasesFromExistingDumps(configFor(body)));
    post('/api/dump', async body => {
        const config = configFor(body);
        await withDatabase(config, connection => dumpAllDatabases(connection, 'dump', config));
        return { message: 'Dump completed successfully' };
    });
    post('/api/compare', body => {
        const config = configFor(body);
        return withDatabase(config, connection => compareAllDatabases(connection, config.output, false, 'compare', config));
    });
    post('/api/apply', async body => {
        const result = await withDatabase(configFor(body), connection => applyDifferences(connection, body.database, body.diffs));
        if (result.failures.length) {
            throw Object.assign(new Error(`Applied ${result.attempted - result.failures.length} of ${result.attempted}. ${result.failures.map(f => `${f.description} (${f.message})`).join('; ')}`), result);
        }
        return { message: `Applied ${result.attempted} of ${result.attempted}.`, warnings: result.warnings };
    });
    post('/api/applyAll', async body => {
        const { differences } = body;
        if (!differences || typeof differences !== 'object' || Array.isArray(differences)
            || Object.values(differences).some(diffs => !Array.isArray(diffs) || diffs.some(d => !d || typeof d.type !== 'string'))) {
            throw badRequest('differences must map database names to arrays of differences.');
        }
        const config = configFor(body);
        if (config.database && Object.keys(differences).some(db => db !== config.database)) throw badRequest('Differences include a database outside the selected scope.');
        if (Object.entries(differences).some(([database, diffs]) => diffs.some(diff => diff.type === 'missing_database' && diff.database !== database))) {
            throw badRequest('A missing_database difference must match its database scope.');
        }
        const result = await withDatabase(config, connection => applyAllDifferences(connection, differences));
        return { ...result, message: `Applied ${result.attempted} difference(s). Compare again to verify.` };
    });
    post('/api/versions', body => {
        const config = configFor(body);
        return withDatabase(config, connection => getVersionInfo(connection, config.output));
    });
    post('/api/acceptCurrent', async body => {
        const config = configFor(body);
        if (!config.output) throw badRequest('No template folder selected');
        assertOutsidePackage(config.output);
        await withDatabase(config, connection => acceptCurrentIntoTemplate(connection, config.output, body.database, body.diffs));
        return { message: 'Template updated with the current values' };
    });
    post('/api/templateDrift', body => {
        const config = configFor(body);
        if (!config.output) throw badRequest('No template folder selected');
        return findTemplateDrift(config.output);
    });
    post('/api/resolveTemplateDrift', async body => {
        const config = configFor(body);
        if (!config.output) throw badRequest('No template folder selected');
        await resolveTemplateDrift(config.output, body.database, body.table, body.keep);
        return { message: `${body.database}.${body.table}: kept the ${body.keep === 'json' ? 'JSON' : '.sql file'} version` };
    });
    post('/api/performance', body => {
        const options = body.options ?? {};
        if (typeof options !== 'object' || Array.isArray(options)) throw badRequest('options must be an object.');
        return checkPerformance(configFor(body), options);
    });
    post('/api/performance/ai/status', body => getAiStatus(body.model));
    post('/api/performance/ai', body => analyzePerformanceQuery(configFor(body), { database: body.database, digest: body.digest, model: body.model }));
    post('/api/browse-folders', async body => {
        const currentPath = resolve(body.currentPath || process.cwd());
        const contents = await readdir(currentPath, { withFileTypes: true });
        const items = contents.map(entry => ({ name: entry.name, path: join(currentPath, entry.name), isDirectory: entry.isDirectory(), isParent: false }));
        items.sort((a, b) => a.isDirectory === b.isDirectory ? a.name.localeCompare(b.name) : a.isDirectory ? -1 : 1);
        if (currentPath !== resolve(currentPath, '..')) items.unshift({ name: '..', path: resolve(currentPath, '..'), isDirectory: true, isParent: true });
        return { currentPath, items };
    });
    post('/api/create-folder', async body => {
        if (typeof body.folderPath !== 'string' || !body.folderPath) throw badRequest('folderPath is required.');
        const folderPath = resolve(body.folderPath);
        assertOutsidePackage(folderPath);
        await mkdir(folderPath, { recursive: true });
        return { success: true, path: folderPath };
    });
    app.use((error, req, res, next) => {
        if (res.headersSent) return next(error);
        const status = error.status || (['INVALID_PERFORMANCE_OPTIONS', 'INVALID_AI_REQUEST'].includes(error.code) ? 400 : 500);
        res.status(status).json({ message: error.message, error: error.message, failures: error.failures, warnings: error.warnings });
    });
    server.listen(port, argv.uiHost || '127.0.0.1', () => console.log(`Server is running on http://${argv.uiHost || '127.0.0.1'}:${server.address().port}`));
    return server;
};
