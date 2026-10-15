import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// The mysqlsyncr package folder, from src/ or the dist/ build. The CJS build
// rewrites import.meta.url from __filename; a global __dirname can't be trusted
// (node -e sets it to '.')
export const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const isInsidePackage = (dir) => {
    const relative = path.relative(packageRoot, path.resolve(dir));
    return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

/**
 * Throw if dir is the mysqlsyncr package folder or inside it. Dumps and
 * templates kept there are lost when the package is reinstalled or updated.
 */
export const assertOutsidePackage = (dir) => {
    if (dir && isInsidePackage(dir)) {
        throw new Error(`${path.resolve(dir)} is inside the mysqlsyncr package folder (${packageRoot}). Choose a folder outside it with --output.`);
    }
}

/**
 * Why dir can't be read as a template: it doesn't exist, isn't a folder, or has
 * no <database>/<database>.json in it. Null when it's usable.
 */
export const templateFolderProblem = (dir) => {
    const resolved = path.resolve(dir);
    let stat;
    try {
        stat = fs.statSync(resolved);
    } catch {
        return `${resolved} doesn't exist.`;
    }
    if (!stat.isDirectory()) return `${resolved} isn't a folder.`;
    const hasDatabase = fs.readdirSync(resolved, { withFileTypes: true })
        .some(entry => entry.isDirectory() && fs.existsSync(path.join(resolved, entry.name, `${entry.name}.json`)));
    return hasDatabase ? null : `${resolved} has no template in it (no <database>/<database>.json). Run dump first, or choose the template folder.`;
}
