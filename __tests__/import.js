import { compare } from '../src/index.js';
const dotenv = await import('dotenv');
dotenv.config( { path: '../.env' } );
console.log(`DB_STRUCTURE_PATH: ${process.env.DB_STRUCTURE_PATH}`);
console.log(`DB_PASSWORD: ${process.env.DB_PASSWORD}`);
const config ={
    host: "127.0.0.1",
    user: 'root',
    password: process.env.DB_PASSWORD,
    port: 3306
};
const testDbConnection = async () => {
        
        const diffs = await compare(config, process.env.DB_STRUCTURE_PATH);
    console.log(diffs);
}

testDbConnection();


