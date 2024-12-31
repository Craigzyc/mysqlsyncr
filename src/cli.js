import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { setVerbose } from './loggers.js';

export const cli = () => {
    const argv = yargs(hideBin(process.argv))
        .command('dump', 'Dump the database structure to files')
        .command('compare', 'Compare the database structure with JSON dumps (dry run)')
        .command('update', 'Update the database structure based on JSON dumps')
        .command('ui', 'Open the UI')
        .option('uiPort', { alias: 'U', describe: 'UI port', default: 3600 })
        .option('openUI', { alias: 'O', describe: 'Open UI', default: true })
        .option('host', { alias: 'h', describe: 'Database host', default: 'localhost' })
        .option('port', { alias: 'P', describe: 'Database port', default: 3306 })
        .option('user', { alias: 'u', describe: 'Database user', default: 'root' })
        .option('password', { alias: 'p', describe: 'Database password', default: '' })
        .option('database', { alias: 'd', describe: 'Target database', default: null })
        .option('output', { alias: 'o', describe: 'Output directory for dumping. default is one level up from the current directory in a new folder called db-dump', default: '../db-dump' })
        .option('verbose', { alias: 'v', describe: 'Enable verbose logging', type: 'boolean', default: false })
        // .demandCommand(1)
        .help()
        .argv;

    const command = argv._[0];
    const config = {
        host: argv.host,
        port: argv.port,
        user: argv.user,
        password: argv.password,
    };

    setVerbose(argv.verbose);

    return { command, config, argv };
};