import express from 'express';
import http from 'http';
import { dumpAllDatabases, getDatabasesFromExistingDumps } from './dump.js'; // Import necessary functions
import { compareAllDatabases } from './compare.js';
import { DBStructureChecker } from './index.js'; // Import your DBStructureChecker class
import { applyDifferences } from './apply.js';
import cors from 'cors';

export const startApiServer = (port) => {
    const app = express();
    app.use(cors({origin:'*'}));
    const server = http.createServer(app);
    app.use(express.json()); // Middleware to parse JSON requests

    app.post('/api/getDatabasesFromExistingDumps', async (req, res) => {
        const { config } = req.body;
        const databases = await getDatabasesFromExistingDumps(config);
        res.json(databases);
    });

    // API endpoint to dump the database
    app.post('/api/dump', async (req, res) => {
        const { config, database } = req.body;
        const checker = new DBStructureChecker(config, database);
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
        const { config } = req.body;
        const checker = new DBStructureChecker(config, config.database);
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
        const { config, database, diffs } = req.body;
        console.log('Applying differences:', diffs);
        const checker = new DBStructureChecker(config, database);
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

    // Start the server
    server.listen(port, () => {
        console.log(`Server is running on http://localhost:${port}`);
    });
}; 