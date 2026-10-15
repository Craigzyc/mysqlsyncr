import fs from 'fs';
import os from 'os';
import path from 'path';
import { normalizeVersionFormatting } from '../src/normalizers';
import { getTemplateVersion, versionNotes, adaptSQLForServer, majorMinor } from '../src/versions';
import { findDifferences } from '../src/differences';
import { applyDifferences } from '../src/apply';
import { parseCreateTableSQL } from '../src/parsers';

const structure = (createSQL, procedures = []) => {
    const parsed = parseCreateTableSQL(createSQL);
    return { tables: { [parsed.name]: { ...parsed, triggers: [], createSQL } }, procedures };
};

// The same table as SHOW CREATE TABLE prints it on each version
const mysql57 = `CREATE TABLE \`Readings\` (
  \`id\` int(11) NOT NULL AUTO_INCREMENT,
  \`count\` bigint(20) unsigned NOT NULL DEFAULT '0',
  \`active\` tinyint(1) NOT NULL DEFAULT '1',
  \`level\` tinyint(4) DEFAULT NULL,
  \`made\` year(4) DEFAULT NULL,
  \`code\` int(5) unsigned zerofill DEFAULT NULL,
  \`name\` varchar(45) CHARACTER SET utf8 DEFAULT NULL,
  PRIMARY KEY (\`id\`)
) ENGINE=InnoDB DEFAULT CHARSET=latin1`;
const mysql80 = `CREATE TABLE \`Readings\` (
  \`id\` int NOT NULL AUTO_INCREMENT,
  \`count\` bigint unsigned NOT NULL DEFAULT '0',
  \`active\` tinyint(1) NOT NULL DEFAULT '1',
  \`level\` tinyint DEFAULT NULL,
  \`made\` year DEFAULT NULL,
  \`code\` int(5) unsigned zerofill DEFAULT NULL,
  \`name\` varchar(45) CHARACTER SET utf8mb3 DEFAULT NULL,
  PRIMARY KEY (\`id\`)
) ENGINE=InnoDB DEFAULT CHARSET=latin1`;

describe('formatting that differs between MySQL 5.7 and 8.0', () => {
    test('integer widths and year(4) are dropped, except tinyint(1) and zerofill', () => {
        expect(normalizeVersionFormatting('int(11)')).toBe('int');
        expect(normalizeVersionFormatting('bigint(20) unsigned')).toBe('bigint unsigned');
        expect(normalizeVersionFormatting('tinyint(1)')).toBe('tinyint(1)');
        expect(normalizeVersionFormatting('int(5) unsigned zerofill')).toBe('int(5) unsigned zerofill');
        expect(normalizeVersionFormatting('year(4)')).toBe('year');
        expect(normalizeVersionFormatting('varchar(10) CHARSET utf8mb3 COLLATE utf8mb3_bin')).toBe('varchar(10) CHARSET utf8 COLLATE utf8_bin');
    });

    test('a 5.7 table matches the same table on 8.0, both ways', () => {
        expect(findDifferences(structure(mysql80 + ';'), structure(mysql57))).toEqual([]);
        expect(findDifferences(structure(mysql57 + ';'), structure(mysql80))).toEqual([]);
    });

    test('real type changes are still reported', () => {
        const changed = mysql57.replace('bigint(20) unsigned', 'bigint(20)').replace('tinyint(1) NOT NULL', 'tinyint(4) NOT NULL');
        const diffs = findDifferences(structure(mysql80 + ';'), structure(changed));
        expect(diffs.map(d => `${d.field.Field} ${d.info}`).sort()).toEqual(['active Type', 'count Type']);
    });

    test('procedures printed by each version match', () => {
        const proc57 = 'CREATE DEFINER=`root`@`%` PROCEDURE `P`(IN a int(11), IN b varchar(10) CHARSET utf8)\nBEGIN\n  SELECT a;\nEND';
        const proc80 = 'CREATE DEFINER=`root`@`%` PROCEDURE `P`(IN a int, IN b varchar(10) CHARSET utf8mb3)\nBEGIN\n  SELECT a;\nEND';
        expect(findDifferences({ tables: {}, procedures: [{ Name: 'P', Definition: proc80 }] }, { tables: {}, procedures: [{ Name: 'P', Definition: proc57 }] })).toEqual([]);
    });
});

describe('template and server versions', () => {
    const tempDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'mysqlsyncr-version-'));
    const writeTemplate = (dir, createSQL) => {
        fs.mkdirSync(path.join(dir, 'Alerts'));
        fs.writeFileSync(path.join(dir, 'Alerts', 'Alerts.json'), JSON.stringify(structure(createSQL)));
    };

    test('uses the version dump recorded', async () => {
        const dir = tempDir();
        fs.writeFileSync(path.join(dir, 'dumpInfo.json'), JSON.stringify({ timestamp: 'x', mysqlVersion: '8.0.36' }));
        expect(await getTemplateVersion(dir)).toEqual({ version: '8.0.36', inferred: false });
    });

    test('infers it from older templates', async () => {
        const dir57 = tempDir();
        writeTemplate(dir57, mysql57.replace(/ CHARACTER SET utf8/, ''));
        expect(await getTemplateVersion(dir57)).toMatchObject({ version: '5.7', inferred: true });
        const dir80 = tempDir();
        writeTemplate(dir80, mysql80);
        expect(await getTemplateVersion(dir80)).toMatchObject({ version: '8.0', inferred: true });
    });

    test('explains what differs between versions', () => {
        expect(majorMinor('5.7.44-log')).toBe('5.7');
        expect(versionNotes('8.0.36', '8.0.19')).toEqual([]);
        expect(versionNotes('8.0', '5.7.44')).toHaveLength(3);
        expect(versionNotes('5.7.44', '8.0.36')).toHaveLength(1);
        expect(versionNotes(undefined, '8.0.36')).toEqual([]);
    });
});

describe('applying an 8.0 template to a 5.7 server', () => {
    test('8.0 collations are swapped for ones 5.7 has', () => {
        expect(adaptSQLForServer('DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci', '5.7.44')).toBe('DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci');
        expect(adaptSQLForServer('COLLATE utf8mb4_0900_bin', '5.7.44')).toBe('COLLATE utf8mb4_bin');
        expect(adaptSQLForServer('COLLATE utf8mb4_0900_ai_ci', '8.0.36')).toBe('COLLATE utf8mb4_0900_ai_ci');
    });

    test('statements are adapted for the server they run on', async () => {
        const statements = [];
        const connection = {
            query: async (sql) => {
                if (sql.startsWith('SELECT VERSION')) return [{ version: '5.7.44-log' }];
                if (!sql.startsWith('USE')) statements.push(sql);
                return [];
            }
        };
        await applyDifferences(connection, 'Alerts', [
            { type: 'missing_table', tableName: 'T', createSQL: 'CREATE TABLE `T` (\n  `a` int\n) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci' }
        ]);
        expect(statements).toEqual(['CREATE TABLE `T` (\n  `a` int\n) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci']);
    });
});
