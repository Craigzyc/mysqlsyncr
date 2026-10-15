import fs from 'fs/promises';
import path from 'path';

// '8.0.36-log' -> { major: 8, minor: 0 }; also takes '5.7'
const parseVersion = (version) => {
    const match = typeof version === 'string' && version.match(/^(\d+)\.(\d+)/);
    return match ? { major: Number(match[1]), minor: Number(match[2]) } : null;
}

export const majorMinor = (version) => {
    const parsed = parseVersion(version);
    return parsed ? `${parsed.major}.${parsed.minor}` : null;
}

const isBefore80 = (version) => {
    const parsed = parseVersion(version);
    return !!parsed && parsed.major < 8;
}

export const getServerVersion = async (connection) => {
    try {
        const rows = await connection.query('SELECT VERSION() AS version');
        return rows?.[0]?.version ?? null;
    } catch {
        return null;
    }
}

/**
 * The MySQL version a template was dumped from: recorded in dumpInfo.json by
 * dump, or else inferred from how its SQL is written. Returns
 * { version, inferred, reason? } or null when it can't tell.
 */
export const getTemplateVersion = async (dir) => {
    try {
        const info = JSON.parse(await fs.readFile(path.join(dir, 'dumpInfo.json'), 'utf-8'));
        if (info.mysqlVersion) return { version: info.mysqlVersion, inferred: false };
    } catch {
        // No dumpInfo.json, or written before versions were recorded
    }

    let sql = '';
    try {
        for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
            if (!entry.isDirectory()) continue;
            try {
                const structure = JSON.parse(await fs.readFile(path.join(dir, entry.name, `${entry.name}.json`), 'utf-8'));
                sql += Object.values(structure.tables || {}).map(t => t.createSQL || '').join('\n');
            } catch {
                // Not a database folder
            }
        }
    } catch {
        return null;
    }
    if (/utf8mb4_0900_|\butf8mb3\b/i.test(sql)) {
        return { version: '8.0', inferred: true, reason: 'uses utf8mb4_0900 collations or utf8mb3, which only 8.0 prints' };
    }
    if (/\b(?:smallint|mediumint|int|bigint)\(\d+\)|\btinyint\((?!1\))\d+\)/i.test(sql)) {
        return { version: '5.7', inferred: true, reason: 'shows integer display widths like int(11), as 5.7 and 8.0 before 8.0.19 do' };
    }
    if (/\b(?:smallint|mediumint|int|bigint)\b(?!\()/i.test(sql)) {
        return { version: '8.0', inferred: true, reason: 'shows integers without display widths, as 8.0.19 and later do' };
    }
    return null;
}

/**
 * What to know when the template and the server are different MySQL versions.
 */
export const versionNotes = (templateVersion, serverVersion) => {
    const template = majorMinor(templateVersion);
    const server = majorMinor(serverVersion);
    if (!template || !server || template === server) return [];
    const notes = [
        `The template is from MySQL ${template} and the server is MySQL ${server}. Integer display widths (int(11) vs int), YEAR(4) and utf8 vs utf8mb3 are printed differently by these versions and are ignored when comparing.`
    ];
    if (isBefore80(serverVersion) && !isBefore80(templateVersion)) {
        notes.push(`MySQL ${server} has no utf8mb4_0900 collations, so tables and columns are created with utf8mb4_general_ci (utf8mb4_bin for utf8mb4_0900_bin) instead.`);
        notes.push(`Expression defaults such as DEFAULT (...) need MySQL 8.0.13 or later and fail on MySQL ${server}.`);
    }
    return notes;
}

export const getVersionInfo = async (connection, templateDir) => {
    const server = await getServerVersion(connection);
    const template = await getTemplateVersion(templateDir);
    return { server, template, notes: versionNotes(template?.version, server) };
}

/**
 * Rewrite SQL from a template so the server can run it: MySQL 5.7 doesn't
 * know the utf8mb4_0900 collations that 8.0 uses by default, or the utf8mb3_
 * collation names 8.0 prints.
 */
export const adaptSQLForServer = (sql, serverVersion) => {
    if (typeof sql !== 'string' || !isBefore80(serverVersion)) return sql;
    return sql
        .replace(/\butf8mb4_0900_bin\b/gi, 'utf8mb4_bin')
        .replace(/\butf8mb4_0900_\w+/gi, 'utf8mb4_general_ci')
        .replace(/\butf8mb3_(\w+)/gi, 'utf8_$1');
}
