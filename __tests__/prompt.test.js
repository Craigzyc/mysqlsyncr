import fs from 'fs';
import os from 'os';
import path from 'path';
import { PassThrough } from 'stream';
import { promptForOptions, promptForPassword } from '../src/prompt';

const defaults = () => ({ host: 'localhost', port: 3306, user: 'root', password: undefined, database: null, output: '../db-dump', write: false });

// A folder holding a one-database template, as compare/update/rebuild need
const templateDir = () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mysqlsyncr-prompt-'));
    fs.mkdirSync(path.join(dir, 'Alerts'));
    fs.writeFileSync(path.join(dir, 'Alerts', 'Alerts.json'), '{"tables":{}}');
    return dir;
};

// Answers the prompts one line at a time, each once its question has been written
const answer = async (answers, ask) => {
    const input = new PassThrough();
    const output = new PassThrough();
    let written = '';
    let next = 0;
    output.on('data', (chunk) => {
        written += chunk.toString();
        if (/[:)] $/.test(written) && next < answers.length) {
            written = '';
            const line = answers[next++];
            setImmediate(() => input.write(`${line}\r`));
        }
    });
    let transcript = '';
    output.on('data', (chunk) => { transcript += chunk.toString(); });
    const result = await ask({ input, output });
    return { result, transcript };
};

const run = async (answers, argv = defaults()) => {
    const { result, transcript } = await answer(answers, (streams) => promptForOptions(argv, streams));
    return { command: result, argv, transcript };
};

describe('promptForOptions', () => {
    test('compare: asks for the connection, keeping defaults for blank answers', async () => {
        const dir = templateDir();
        const { command, argv, transcript } = await run(['1', 'db.example', '', 'admin', 'secret', '', dir]);
        expect(command).toBe('compare');
        expect(argv).toMatchObject({ host: 'db.example', port: 3306, user: 'admin', password: 'secret', database: null, output: dir });
        expect(transcript).not.toContain('secret');
        expect(transcript).toContain('typing is hidden');
    });

    test('a blank password is no password', async () => {
        const { argv } = await run(['compare', '', '', '', '', '', templateDir()]);
        expect(argv.password).toBe('');
    });

    test('accepts the command name and a single database; dump may use a new folder', async () => {
        const { command, argv } = await run(['dump', '', '', '', '', 'Alerts', '/new/dump/folder']);
        expect(command).toBe('dump');
        expect(argv).toMatchObject({ database: 'Alerts', output: '/new/dump/folder' });
    });

    test('update needs confirming', async () => {
        expect((await run(['update', '', '', '', '', '', templateDir(), 'n'])).command).toBeNull();
        expect((await run(['update', '', '', '', '', '', templateDir(), 'y'])).command).toBe('update');
    });

    test('rebuild asks only for the folder and whether to write', async () => {
        const dir = templateDir();
        const { command, argv } = await run(['5', dir, 'y']);
        expect(command).toBe('rebuild');
        expect(argv).toMatchObject({ output: dir, write: true, host: 'localhost' });
    });

    test('ui asks nothing else', async () => {
        expect((await run(['ui'])).command).toBe('ui');
    });
});

describe('folder checks', () => {
    test('asks again until the folder is outside the package', async () => {
        const dir = templateDir();
        const { command, argv, transcript } = await run(['rebuild', './templates', '', dir, 'n']);
        expect(command).toBe('rebuild');
        expect(argv.output).toBe(dir);
        expect(transcript).toContain('inside the mysqlsyncr package folder');
    });

    test('compare asks again when the folder is missing or has no template', async () => {
        const dir = templateDir();
        const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'mysqlsyncr-empty-'));
        const { argv, transcript } = await run(['compare', '', '', '', '', '', path.join(dir, 'missing'), empty, dir]);
        expect(argv.output).toBe(dir);
        expect(transcript).toContain("doesn't exist");
        expect(transcript).toContain('has no template in it');
    });
});

describe('promptForPassword', () => {
    test('asks without echoing, naming the user and host', async () => {
        const { result, transcript } = await answer(['hunter2'], (streams) => promptForPassword({ user: 'root', host: 'localhost' }, streams));
        expect(result).toBe('hunter2');
        expect(transcript).toContain('for root@localhost');
        expect(transcript).not.toContain('hunter2');
    });
});
