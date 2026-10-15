import readline from 'readline';
import path from 'path';
import { isInsidePackage, packageRoot, templateFolderProblem } from './paths.js';

const COMMANDS = [
    { name: 'compare', description: 'Compare the database structure with JSON dumps (dry run)' },
    { name: 'update', description: 'Update the database structure based on JSON dumps' },
    { name: 'dump', description: 'Dump the database structure to files' },
    { name: 'ui', description: 'Open the UI' },
    { name: 'rebuild', description: "Rebuild the dump's JSON from each table's CREATE TABLE" }
];

// Commands that connect to MySQL from the command line (the UI asks for its own connection)
export const DATABASE_COMMANDS = ['compare', 'update', 'dump'];

// Commands that read an existing template, so its folder must already hold one
const TEMPLATE_COMMANDS = ['compare', 'update', 'rebuild'];

const PASSWORD_LABEL = 'MySQL password (typing is hidden, Enter for none)';

const createPrompter = ({ input = process.stdin, output = process.stdout } = {}) => {
    const rl = readline.createInterface({ input, output, terminal: true });

    // Lets a password be typed without echoing it
    let muted = false;
    rl._writeToOutput = (text) => {
        if (!muted) rl.output.write(text);
    };

    const question = (text) => new Promise(resolve => rl.question(text, resolve));
    const ask = async (label, defaultValue) => {
        const hint = defaultValue !== undefined && defaultValue !== null && defaultValue !== '' ? ` (${defaultValue})` : '';
        const answer = (await question(`${label}${hint}: `)).trim();
        return answer === '' ? defaultValue : answer;
    };
    const askHidden = async (label) => {
        rl.output.write(`${label}: `);
        muted = true;
        const answer = await question('');
        muted = false;
        rl.output.write('\n');
        return answer;
    };
    const confirm = async (label) => /^y(es)?$/i.test(await ask(`${label} (y/N)`));
    const say = (text) => output.write(`${text}\n`);
    return { ask, askHidden, confirm, say, close: () => rl.close() };
}

/**
 * Ask for the MySQL password when a command was given without --password.
 */
export const promptForPassword = async (argv, streams) => {
    const prompter = createPrompter(streams);
    try {
        return await prompter.askHidden(`${PASSWORD_LABEL} for ${argv.user}@${argv.host}`);
    } finally {
        prompter.close();
    }
}

/**
 * Ask for the command and its options when mysqlsyncr is run with no arguments.
 * Fills in argv and returns the chosen command, or null if the user cancels.
 */
export const promptForOptions = async (argv, streams) => {
    const { ask, askHidden, confirm, say, close } = createPrompter(streams);

    try {
        say('No command given. Choose one:');
        COMMANDS.forEach((command, i) => say(`  ${i + 1}) ${command.name.padEnd(8)} ${command.description}`));
        const choice = String(await ask('Command', '1'));
        const command = COMMANDS[Number(choice) - 1]?.name ?? COMMANDS.find(c => c.name === choice.toLowerCase())?.name;
        if (!command) {
            console.error(`Unknown command: ${choice}`);
            return null;
        }

        if (DATABASE_COMMANDS.includes(command)) {
            argv.host = await ask('MySQL host', argv.host);
            argv.port = Number(await ask('MySQL port', argv.port));
            argv.user = await ask('MySQL user', argv.user);
            argv.password = await askHidden(PASSWORD_LABEL);
            argv.database = (await ask('Database (blank for all)', argv.database ?? '')) || null;
        }
        if (command !== 'ui') {
            argv.output = await ask(command === 'dump' ? 'Folder to dump to' : 'Template folder', argv.output);
            for (;;) {
                let problem = null;
                if (!argv.output) problem = '';
                else if (isInsidePackage(argv.output)) problem = `That folder is inside the mysqlsyncr package folder (${packageRoot}). Choose one outside it.`;
                else if (TEMPLATE_COMMANDS.includes(command)) problem = templateFolderProblem(argv.output);
                if (problem === null) break;
                if (problem) say(problem);
                argv.output = await ask('Folder');
            }
            if (command === 'dump') say(`Dumping to ${path.resolve(argv.output)}`);
        }
        if (command === 'rebuild') {
            argv.write = await confirm('Write the rebuilt files? No lists the changes only');
        }
        if (command === 'update' && !await confirm(`This will change the structure of ${argv.database ?? 'every database'} on ${argv.host}. Continue?`)) {
            say('Cancelled.');
            return null;
        }
        return command;
    } finally {
        close();
    }
}
