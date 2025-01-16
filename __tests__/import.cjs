const mysqlSyncr = require('../dist/index.cjs');
const path = require('path');

const dotenv = require('dotenv');
dotenv.config({ path: path.resolve(__dirname, '../.env') });

console.log(`DB_STRUCTURE_PATH: ${process.env.DB_STRUCTURE_PATH}`);
console.log(`DB_PASSWORD: ${process.env.DB_PASSWORD}`);
const config ={
    host: "127.0.0.1",
    user: 'root',
    password: process.env.DB_PASSWORD,
    port: 3306
};
const testDbConnection = async () => {
        console.log(mysqlSyncr);
        const diffs = await mysqlSyncr.compare(config, process.env.DB_STRUCTURE_PATH);
    console.log(diffs);
}

testDbConnection();


