import express from 'express';
import http from 'http';
import { dumpAllDatabases, getDatabasesFromExistingDumps } from './dump.js'; // Import necessary functions
import { compareAllDatabases } from './compare.js';
import { DBStructureChecker } from './index.js'; // Import your DBStructureChecker class
import { applyDifferences } from './apply.js';
import cors from 'cors';
import { join } from 'path';
import { readdir, mkdir } from 'fs/promises';
import { resolve } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

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

// Create a function to get the package root directory that works in both ESM and CJS
const getPackageRoot = () => {
    if (typeof __dirname !== 'undefined') {
        // CommonJS
        return join(__dirname, '..');
    } else {
        // ESM
        const __filename = fileURLToPath(import.meta.url);
        const __dirname = dirname(__filename);
        return join(__dirname, '..');
    }
};

// Use the function to get the root path
const packageRoot = getPackageRoot();

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
                await applyDifferences(checker.connection, database, diffs);
                res.json({ message: 'Apply completed successfully' });
            } catch (err) {
                res.status(500).json({ message: err.message });
            } finally {
                await checker.closeConnection();
            }
        });
    });

    app.post('/api/browse-folders', async (req, res) => {
        try {
            const { currentPath = packageRoot } = req.body;
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
                : resolve(packageRoot, folderPath);

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