import { execFileSync } from 'node:child_process';

test('module imports without running the CLI or connecting to a database', () => {
    const output = execFileSync(process.execPath, ['--input-type=module', '-e', `
        const api = await import('./src/index.js');
        for (const name of ['DBStructureChecker', 'compare', 'apply', 'dumpAllDatabases', 'startApiServer']) {
            if (typeof api[name] !== 'function') throw new Error(name + ' export missing');
        }
        console.log('imported');
    `], { cwd: process.cwd(), encoding: 'utf8', timeout: 15000 });
    expect(output.trim()).toBe('imported');
});
