const { DBStructureChecker, compareAllDatabases } = import('../src/index.js');
const dotenv = require('dotenv');
dotenv.config();
const config ={
    host: "127.0.0.1",
    user: 'root',
    password: process.env.DB_PASSWORD,
    port: 3306
};

describe('Connect to database', () => {

    test('should run a comparison of the DB structure', async () => {
        const checker = new DBStructureChecker(config);
        
        const diffs = await compareAllDatabases(
            checker.connection, 
            process.env.DB_STRUCTURE_PATH, 
            false, 
            'compare'
        );
        
        expect(Array.isArray(diffs)).toBe(true);
    });


}); 
