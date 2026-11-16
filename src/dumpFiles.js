import fs from 'fs/promises';
import path from 'path';

// A dump is a directory containing <directory-name>.json. Root-level config
// files and unrelated directories must never be treated as database names.
export async function getDatabaseDumpNames(inputDir) {
    const entries = await fs.readdir(inputDir, { withFileTypes: true });
    const databases = [];
    for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const manifest = path.join(inputDir, entry.name, `${entry.name}.json`);
        try {
            if ((await fs.stat(manifest)).isFile()) databases.push(entry.name);
        } catch (error) {
            if (!['ENOENT', 'ENOTDIR'].includes(error.code)) throw error;
        }
    }
    return databases;
}
