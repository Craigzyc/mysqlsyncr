import express from 'express';
import http from 'http';
import { dumpAllDatabases, getDatabasesFromExistingDumps } from './dump.js'; // Import necessary functions
import { compareAllDatabases } from './compare.js';
import { DBStructureChecker } from './DBStructureChecker.js';
import { applyDifferences } from './apply.js';
import { packageRoot, assertOutsidePackage } from './paths.js';
import { acceptCurrentIntoTemplate } from './acceptCurrent.js';
import { getVersionInfo } from './versions.js';
import cors from 'cors';
import { join } from 'path';
import { readdir, mkdir } from 'fs/promises';
import { resolve } from 'path';


const setConfig = (config, argv) => {
    if(!config.host && argv.host){
        config.host = argv.host;
    }
    if(!config.port && argv.port){
        config.port = argv.port;
    }
    if(!config.user && argv.user){
        config.user = argv.user;
    }
    if(!config.password && argv.password){
        config.password = argv.password;
    }
    if(!config.output && argv.output !=='../db-dump'){
        config.output = argv.output;
    }
    return config;
}


export const startApiServer = (port, argv) => {
    const app = express();
    app.use(cors({ origin: '*' }));
    const server = http.createServer(app);
    app.use(express.json({ limit: '50mb' })); 
    app.use(express.urlencoded({ limit: '50mb', extended: true })); 

    console.log(`Serving UI from ${join(packageRoot, 'ui/dist/spa')}`);
    app.use(express.static(join(packageRoot, 'ui/dist/spa')));

    app.post('/api/getDatabasesFromExistingDumps', async (req, res) => {
        let { config } = req.body;
        config = setConfig(config, argv);
        const databases = await getDatabasesFromExistingDumps(config);
        res.json(databases);
    });

    // API endpoint to dump the database
    app.post('/api/dump', async (req, res) => {
        let { config, database } = req.body;
        config = setConfig(config, argv);
        const checker = new DBStructureChecker(config, database);

        checker.connection.on('error', (err) => {
            console.error('Database connection error in route dump:', err);
            res.status(500).json({ message: 'Database connection failed', error: err.message });
        });

        checker.connection.on('connect', async () => {
            console.log('Connected to the database');
            checker.targetDatabase = database;
            checker.command = 'dump';
            checker.options = req.body;
            try {
                console.log('Dumping the database structure to files');
                await dumpAllDatabases(checker.connection, 'dump', config);
                res.json({ message: 'Dump completed successfully' });
            } catch (err) {
                res.status(500).json({ message: err.message });
            } finally {
                await checker.closeConnection();
            }
        });
    });

    // API endpoint to compare the database
    app.post('/api/compare', async (req, res) => {
        let { config, database } = req.body;
        config = setConfig(config, argv);
        const checker = new DBStructureChecker(config, database);

        checker.connection.on('error', (err) => {
            console.error('Database connection error in route compare:', err);
            res.status(500).json({ message: 'Database connection failed', error: err.message });
        });

        checker.connection.on('connect', async () => {
            console.log('Connected to the database');
            checker.targetDatabase = config.database;
            checker.command = 'compare';
            checker.options = req.body;
            try {
                delete req.body.output;
                console.log('Comparing the database structure with JSON dumps (dry run)');
                let diffs = await compareAllDatabases(checker.connection, config.output, false, 'compare', config);
                res.json(diffs);
            } catch (err) {
                console.log(err);
                console.log(req.body);
                res.status(500).json({ message: err.message });
            } finally {
                await checker.closeConnection();
            }
        })

    });

    // API endpoint to apply differences
    app.post('/api/apply', async (req, res) => {
        let { config, database, diffs } = req.body;
        config = setConfig(config, argv);
        console.log('Applying differences:', diffs);
        const checker = new DBStructureChecker(config, database);

        checker.connection.on('error', (err) => {
            console.error('Database connection error in route apply:', err);
            res.status(500).json({ message: 'Database connection failed', error: err.message });
        });

        checker.connection.on('connect', async () => {
            console.log('Connected to the database');
            checker.targetDatabase = database;
            checker.command = 'apply';
            checker.options = req.body;
            try {
                console.log('Applying the database structure based on JSON dumps');
                const { attempted, failures, warnings } = await applyDifferences(checker.connection, database, diffs);
                const warningText = warnings.length
                    ? ` ${warnings.length} applied with changes: ` + warnings.map(w => `${w.description} (${w.message})`).join('; ')
                    : '';
                if (failures.length) {
                    // Reporting success here would be a lie: the same differences come
                    // back on the next compare with no indication of why.
                    res.status(500).json({
                        message: `Applied ${attempted - failures.length} of ${attempted}. ${failures.length} failed: `
                            + failures.map(f => `${f.description} (${f.message})`).join('; ') + warningText,
                        failures,
                        warnings,
                    });
                } else {
                    res.json({
                        message: `Applied ${attempted} of ${attempted}.` + warningText,
                        warnings,
                    });
                }
            } catch (err) {
                res.status(500).json({ message: err.message });
            } finally {
                await checker.closeConnection();
            }
        });
    });

    // API endpoint for the server's and the template's MySQL versions
    app.post('/api/versions', async (req, res) => {
        let { config } = req.body;
        config = setConfig(config || {}, argv);
        const checker = new DBStructureChecker(config);

        checker.connection.on('error', (err) => {
            if (!res.headersSent) res.status(500).json({ message: 'Database connection failed', error: err.message });
        });

        checker.connection.on('connect', async () => {
            try {
                res.json(await getVersionInfo(checker.connection, config.output));
            } catch (err) {
                res.status(500).json({ message: err.message });
            } finally {
                await checker.closeConnection();
            }
        });
    });

    // API endpoint to overwrite the template with the database's current values
    app.post('/api/acceptCurrent', async (req, res) => {
        let { config, database, diffs } = req.body;
        config = setConfig(config, argv);
        if (!config.output) {
            return res.status(400).json({ message: 'No template folder selected' });
        }
        try {
            assertOutsidePackage(config.output);
        } catch (err) {
            return res.status(400).json({ message: err.message });
        }
        const checker = new DBStructureChecker(config, database);

        checker.connection.on('error', (err) => {
            console.error('Database connection error in route acceptCurrent:', err);
            if (!res.headersSent) res.status(500).json({ message: 'Database connection failed', error: err.message });
        });

        checker.connection.on('connect', async () => {
            try {
                console.log(`Keeping current values in the template for ${diffs?.length ?? 0} difference(s) in ${database}`);
                await acceptCurrentIntoTemplate(checker.connection, config.output, database, diffs || []);
                res.json({ message: 'Template updated with the current values' });
            } catch (err) {
                res.status(500).json({ message: err.message });
            } finally {
                await checker.closeConnection();
            }
        });
    });

    app.post('/api/browse-folders', async (req, res) => {
        try {
            // Start where mysqlsyncr was run from, not in the package folder
            const { currentPath = process.cwd() } = req.body;
            console.log('Browsing folder:', currentPath);

            const resolvedPath = currentPath.startsWith('/') || currentPath.match(/^[A-Z]:\\/)
                ? resolve(currentPath)
                : resolve(currentPath);

            console.log('Resolved path:', resolvedPath);

            const contents = await readdir(resolvedPath, { withFileTypes: true });

            // Separate directories and files
            const items = contents.map(dirent => ({
                name: dirent.name,
                path: join(resolvedPath, dirent.name),
                isDirectory: dirent.isDirectory(),
                isParent: false
            }));

            // Sort items: directories first, then files, both alphabetically
            const sortedItems = items.sort((a, b) => {
                if (a.isDirectory === b.isDirectory) {
                    return a.name.localeCompare(b.name);
                }
                return a.isDirectory ? -1 : 1;
            });

            // Add parent directory option if not at root
            if (resolvedPath !== resolve(resolvedPath, '..')) {
                sortedItems.unshift({
                    name: '..',
                    path: resolve(resolvedPath, '..'),
                    isDirectory: true,
                    isParent: true
                });
            }

            res.json({
                currentPath: resolvedPath,
                items: sortedItems
            });
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    app.post('/api/create-folder', async (req, res) => {
        try {
            const { folderPath } = req.body;
            console.log('Creating folder:', folderPath);

            const resolvedPath = folderPath.startsWith('/') || folderPath.match(/^[A-Z]:\\/)
                ? resolve(folderPath)
                : resolve(process.cwd(), folderPath);
            assertOutsidePackage(resolvedPath);

            await mkdir(resolvedPath, { recursive: true });

            res.json({
                success: true,
                path: resolvedPath
            });
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    // Start the server
    server.listen(port, () => {
        console.log(`Server is running on http://localhost:${port}`);
    });
}; 