import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { setVerbose } from './loggers.js';
import { promptForOptions, promptForPassword, DATABASE_COMMANDS } from './prompt.js';

const COMMANDS = ['dump', 'compare', 'update', 'ui', 'rebuild'];

/**
 * Parse the command line. With no command, asks for the command and its options
 * in a terminal, or prints the help otherwise. command is null when there's nothing to run.
 */
export const cli = async () => {
    const parser = yargs(hideBin(process.argv))
        .command('dump', 'Dump the database structure to files')
        .command('compare', 'Compare the database structure with JSON dumps (dry run)')
        .command('update', 'Update the database structure based on JSON dumps')
        .command('ui', 'Open the UI')
        .command('rebuild', "Rebuild the dump's JSON from each table's CREATE TABLE and list what changes (dry run unless --write)")
        .option('uiPort', { alias: 'U', describe: 'UI port', default: 3600 })
        .option('openUI', { alias: 'O', describe: 'Open UI', default: true })
        .option('host', { alias: 'h', describe: 'Database host', default: 'localhost' })
        .option('port', { alias: 'P', describe: 'Database port', default: 3306 })
        .option('user', { alias: 'u', describe: 'Database user', default: 'root' })
        // No default, so a missing password can be asked for; -p with no value means none
        .option('password', { alias: 'p', describe: 'Database password (asked for in a terminal when not given)', type: 'string' })
        .option('database', { alias: 'd', describe: 'Target database', default: null })
        .option('output', { alias: 'o', describe: 'Output directory for dumping. default is one level up from the current directory in a new folder called db-dump', default: '../db-dump' })
        .option('write', { describe: 'With rebuild, write the rebuilt files', type: 'boolean', default: false })
        .option('verbose', { alias: 'v', describe: 'Enable verbose logging', type: 'boolean', default: false })
        // .demandCommand(1)
        .help();
    const argv = parser.argv;

    let command = argv._[0];
    if (command === undefined) {
        if (process.stdin.isTTY && process.stdout.isTTY) {
            command = await promptForOptions(argv);
        } else {
            parser.showHelp();
            command = null;
        }
    } else if (!COMMANDS.includes(command)) {
        console.error(`Unknown command: ${command}. Use one of: ${COMMANDS.join(', ')}`);
        command = null;
    }

    const interactive = process.stdin.isTTY && process.stdout.isTTY;
    if (DATABASE_COMMANDS.includes(command) && argv.password === undefined) {
        argv.password = interactive ? await promptForPassword(argv) : '';
    }

    const config = {
        host: argv.host,
        port: argv.port,
        user: argv.user,
        password: argv.password,
    };

    setVerbose(argv.verbose);

    return { command, config, argv };
};