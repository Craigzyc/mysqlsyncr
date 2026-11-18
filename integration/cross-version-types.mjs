// Cross-version type/format matrix. Creates the same DDL natively on a MySQL
// 5.7 and an 8.0 server (as deployed databases that were NOT built by
// mysqlsyncr), dumps each, and requires:
//   1. each native database compares clean against BOTH dumps
//   2. each dump restores on BOTH servers and then compares clean against
//      both dumps (5.7 -> 8.0, 8.0 -> 5.7, and same-version round trips)
//   3. real drift is still detected and repaired on both servers
//
// Usage: node integration/cross-version-types.mjs --p57 33057 --p80 33080 [--password x] [--artifacts dir]
// The servers must be throwaway containers: the fixture database is dropped.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import mysql from 'mysql2/promise';
import { compareAllDatabases } from '../src/compare.js';
import { dumpAllDatabases } from '../src/dump.js';

const args = process.argv.slice(2);
const arg = (name, fallback) => args.includes(name) ? args[args.indexOf(name) + 1] : fallback;
const password = arg('--password', 'mysqlsyncr-test-only');
const artifacts = path.resolve(arg('--artifacts') || await fs.mkdtemp(path.join(os.tmpdir(), 'mysqlsyncr-xv-')));
await fs.mkdir(artifacts, { recursive: true });
const DB = 'mysqlsyncr_xv';
const DB2 = 'mysqlsyncr_xv_ref';

// DDL accepted by both 5.7 and 8.0. Spellings deliberately vary (synonyms,
// display widths, implicit defaults) because MySQL normalizes them differently.
const common = [
    `CREATE TABLE ${DB2}.parent (id int(11) NOT NULL AUTO_INCREMENT, code varchar(20) NOT NULL, PRIMARY KEY (id), UNIQUE KEY code (code)) ENGINE=InnoDB DEFAULT CHARSET=latin1`,
    `CREATE TABLE parent (id int(11) NOT NULL AUTO_INCREMENT, name varchar(45) DEFAULT NULL, PRIMARY KEY (id)) ENGINE=InnoDB DEFAULT CHARSET=latin1`,
    `CREATE TABLE numbers (
        id int(11) NOT NULL AUTO_INCREMENT,
        i_plain int, i_width int(11), i_integer integer, i_unsigned int(10) unsigned, i_zerofill int(5) unsigned zerofill,
        bi bigint(20) DEFAULT NULL, bi_u bigint(20) unsigned NOT NULL DEFAULT '0', bi_zf bigint(20) unsigned zerofill DEFAULT NULL,
        si smallint(6) DEFAULT '-1', mi mediumint(9) DEFAULT NULL,
        ti tinyint(4) DEFAULT NULL, ti1 tinyint(1) NOT NULL DEFAULT '0', ti1u tinyint(1) unsigned DEFAULT NULL, ti3u tinyint(3) unsigned DEFAULT '7',
        b bool DEFAULT false, bn boolean NOT NULL DEFAULT TRUE,
        f float, f102 float(10,2) DEFAULT NULL, f7 float(7), f24 float(24), f30 float(30), f_def float DEFAULT 1.5,
        d double, d102 double(10,2), r real, dp double precision, de decimal, de102 decimal(10,2) DEFAULT '0.00', nu numeric(8,3), dc dec(5),
        bt bit DEFAULT b'0', bt8 bit(8) DEFAULT NULL,
        y year, y4 year(4) DEFAULT NULL,
        baud int DEFAULT 19200,
        neg int NOT NULL DEFAULT -5,
        PRIMARY KEY (id)
    ) ENGINE=InnoDB DEFAULT CHARSET=latin1`,
    `CREATE TABLE strings (
        id int NOT NULL,
        c char, c10 char(10) NOT NULL DEFAULT '', vc varchar(255) DEFAULT 'it''s',
        t text, tt tinytext, mt mediumtext, lt longtext, t_null text NULL DEFAULT NULL,
        bl blob, mbl mediumblob, bin binary(4), vb varbinary(16),
        e enum('a','b','c,d') DEFAULT 'a', s set('x','y') DEFAULT NULL,
        u8 varchar(20) CHARACTER SET utf8 DEFAULT NULL,
        u8c varchar(20) CHARACTER SET utf8 COLLATE utf8_unicode_ci DEFAULT NULL,
        u8mb4 varchar(20) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
        u8mb4_bin varchar(20) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
        latin_bin varchar(20) COLLATE latin1_bin DEFAULT NULL,
        comment_q varchar(5) DEFAULT NULL COMMENT 'it''s a "comment", with commas (and parens)',
        PRIMARY KEY (id),
        KEY prefix (t(100)),
        FULLTEXT KEY ft (vc, mt)
    ) ENGINE=InnoDB DEFAULT CHARSET=latin1`,
    `CREATE TABLE utf8_table (id int NOT NULL, name varchar(50), body text, PRIMARY KEY (id)) ENGINE=InnoDB DEFAULT CHARSET=utf8`,
    `CREATE TABLE mb4_general (id int NOT NULL, v varchar(10), c varchar(10) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci, l varchar(10) CHARACTER SET latin1, PRIMARY KEY (id)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci`,
    `CREATE TABLE col_general (id int NOT NULL, c varchar(10) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci, PRIMARY KEY (id)) ENGINE=InnoDB DEFAULT CHARSET=latin1`,
    `CREATE TABLE mb4_table (id int NOT NULL, name varchar(50), body mediumtext, other varchar(10) CHARACTER SET latin1, PRIMARY KEY (id)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    `CREATE TABLE times (
        id int NOT NULL AUTO_INCREMENT,
        created timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        n_updated timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        maybe timestamp NULL DEFAULT NULL,
        dt datetime DEFAULT NULL, dt_now datetime DEFAULT CURRENT_TIMESTAMP, dt3 datetime(3) DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
        ts6 timestamp(6) NULL DEFAULT NULL, d date DEFAULT '2020-01-01', tm time DEFAULT '00:00:00',
        PRIMARY KEY (id), KEY created (created)
    ) ENGINE=InnoDB DEFAULT CHARSET=latin1 COMMENT='times ''table'''`,
    `CREATE TABLE child (
        id int NOT NULL AUTO_INCREMENT, parent_id int(11) NOT NULL, ref_code varchar(20) DEFAULT NULL,
        j json DEFAULT NULL, qty int NOT NULL DEFAULT '1',
        g_virtual int GENERATED ALWAYS AS ((qty * 2)) VIRTUAL,
        g_stored varchar(64) GENERATED ALWAYS AS (concat('p-', qty)) STORED,
        PRIMARY KEY (id), KEY parent_id (parent_id), KEY ref_code (ref_code), KEY multi (parent_id, ref_code),
        CONSTRAINT child_parent FOREIGN KEY (parent_id) REFERENCES parent (id) ON DELETE CASCADE,
        CONSTRAINT child_ref FOREIGN KEY (ref_code) REFERENCES ${DB2}.parent (code) ON UPDATE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=latin1`,
    `CREATE TABLE myisam_t (id int NOT NULL, v varchar(10), PRIMARY KEY (id)) ENGINE=MyISAM DEFAULT CHARSET=latin1`,
    `CREATE TABLE no_charset (id int NOT NULL, v varchar(10), t text, PRIMARY KEY (id))`,
    `CREATE TRIGGER child_bi BEFORE INSERT ON child FOR EACH ROW SET NEW.ref_code = IFNULL(NEW.ref_code, 'é-default')`,
    `CREATE PROCEDURE proc_types(IN p_id int(11), IN p_name varchar(20) CHARSET utf8, OUT p_out decimal(10,2))
     BEGIN
        -- a comment with int(11) inside
        DECLARE v year(4) DEFAULT 2020;
        SELECT CAST(p_id AS char CHARACTER SET utf8) INTO @x;
        SET p_out = 1.50;
     END`,
    `CREATE FUNCTION fn_double(x int(11)) RETURNS int(11) DETERMINISTIC RETURN x * 2`,
    `CREATE VIEW child_view AS SELECT c.id, c.parent_id, p.name, CAST(c.id AS char CHARACTER SET utf8) AS idtext, 'lit' AS lit, concat('a', p.name) AS joined FROM child c JOIN parent p ON p.id = c.parent_id WHERE p.name <> 'x'`,
];
// 8.0-only objects live in their own databases so the common fixture is
// compared everywhere. DB80 holds 8.0 syntax that has a 5.7 approximation
// (0900 collations, INVISIBLE and DESC indexes); DBX holds expression defaults,
// which 5.7 cannot represent, so restoring it there must fail loudly.
const DB80 = 'mysqlsyncr_xv80';
const DBX = 'mysqlsyncr_xvx';
const only80 = {
    [DB80]: [`CREATE TABLE eight (
        id int NOT NULL, name varchar(20) COLLATE utf8mb4_0900_ai_ci DEFAULT NULL, bin varchar(20) COLLATE utf8mb4_0900_bin DEFAULT NULL,
        PRIMARY KEY (id), KEY name_inv (name) INVISIBLE, KEY name_desc (name DESC)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`],
    [DBX]: [`CREATE TABLE expr (
        id int NOT NULL, d varchar(20) DEFAULT (concat('a','b')), j json DEFAULT (json_array()), PRIMARY KEY (id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`],
};
const COMMON = [DB, DB2];
const ALL = [...COMMON, DB80, DBX];

const servers = { '5.7': Number(arg('--p57', 33057)), '8.0': Number(arg('--p80', 33080)) };
const connect = async port => {
    for (let attempt = 0; ; attempt++) {
        try { return await mysql.createConnection({ host: '127.0.0.1', port, user: 'root', password, multipleStatements: false }); }
        catch (error) { if (attempt > 90) throw error; await new Promise(r => setTimeout(r, 1000)); }
    }
};
const conns = {};
for (const [name, port] of Object.entries(servers)) {
    conns[name] = await connect(port);
    const [[{ v }]] = await conns[name].query('SELECT VERSION() v');
    assert.ok(v.startsWith(name + '.'), `port ${port} is ${v}, expected ${name}`);
    conns[name].version = v;
}
const adapter = c => ({ query: async (...q) => (await c.query(...q))[0] });
const count = diffs => Object.values(diffs).reduce((n, d) => n + d.length, 0);
const quiet = async fn => { const log = console.log, table = console.table; console.log = console.table = () => {}; try { return await fn(); } finally { console.log = log; console.table = table; } };
const results = [];
const reset = async c => {
    await c.query('SET FOREIGN_KEY_CHECKS=0');
    for (const db of ALL) await c.query(`DROP DATABASE IF EXISTS ${db}`);
    await c.query('SET FOREIGN_KEY_CHECKS=1');
};
const native = async (name) => {
    const c = conns[name];
    await reset(c);
    await c.query(`CREATE DATABASE ${DB} DEFAULT CHARACTER SET latin1`);
    await c.query(`CREATE DATABASE ${DB2} DEFAULT CHARACTER SET latin1`);
    await c.query(`USE ${DB}`);
    const run = async sql => { try { await c.query(sql); } catch (error) { throw new Error(`${name} rejected fixture DDL: ${error.message}\n${sql}`); } };
    for (const sql of common) await run(sql);
    if (name === '8.0') for (const [db, statements] of Object.entries(only80)) {
        await c.query(`CREATE DATABASE ${db} DEFAULT CHARACTER SET utf8mb4`);
        await c.query(`USE ${db}`);
        for (const sql of statements) await run(sql);
    }
};
// Compare or update the given databases of a template in ONE call, as the CLI
// does, so cross-schema dependencies are ordered across all of them.
const subsets = new Map();
const subset = async (dir, databases) => {
    const key = `${dir}|${databases.join(',')}`;
    if (!subsets.has(key)) {
        const target = path.join(artifacts, 'subsets', String(subsets.size));
        await fs.rm(target, { recursive: true, force: true });
        await fs.mkdir(target, { recursive: true });
        for (const database of databases) await fs.cp(path.join(dir, database), path.join(target, database), { recursive: true });
        await fs.copyFile(path.join(dir, 'dumpInfo.json'), path.join(target, 'dumpInfo.json'));
        subsets.set(key, target);
    }
    return subsets.get(key);
};
const each = async (name, dir, databases, update) => quiet(async () => compareAllDatabases(adapter(conns[name]), await subset(dir, databases), update, update ? 'update' : 'compare', { quiet: true }));
const compare = (name, dir, databases = COMMON) => each(name, dir, databases, false);
const update = (name, dir, databases = COMMON) => each(name, dir, databases, true);
const check = async (label, fn) => {
    try { const detail = await fn(); results.push({ label, status: 'passed', ...(detail || {}) }); console.log(`PASS ${label}`); }
    catch (error) { results.push({ label, status: 'failed', error: error.message, differences: error.differences }); console.log(`FAIL ${label}\n  ${error.message.split('\n').join('\n  ')}`); process.exitCode = 1; }
};
const expectClean = async (name, dir, databases) => {
    const diffs = await compare(name, dir, databases);
    if (count(diffs)) {
        const error = new Error(`${count(diffs)} differences: ${JSON.stringify(Object.values(diffs).flat().map(d => ({ type: d.type, table: d.tableName || d.Name || d.viewName, field: d.field?.Field, changes: d.changes, comparison: d.comparison, options: d.options, currentOptions: d.currentOptions })), null, 1)}`);
        error.differences = diffs;
        throw error;
    }
};
const dumpTo = async (name, dir) => {
    await fs.rm(dir, { recursive: true, force: true });
    await fs.mkdir(dir, { recursive: true });
    await dumpAllDatabases(adapter(conns[name]), 'dump', { output: dir });
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
        if (entry.isDirectory() && !ALL.includes(entry.name)) await fs.rm(path.join(dir, entry.name), { recursive: true });
    }
    return dir;
};
// What a server can hold from a template: 5.7 cannot hold expression defaults.
const restorable = (template, target) => template === '8.0' ? (target === '8.0' ? ALL : [...COMMON, DB80]) : COMMON;

// Dump each server's native fixture.
const dumps = {};
for (const name of Object.keys(servers)) {
    await native(name);
    dumps[name] = await dumpTo(name, path.join(artifacts, `dump-${name}`));
}
// 1. native databases against both dumps (the common databases both can hold)
for (const live of Object.keys(servers)) {
    await native(live);
    for (const template of Object.keys(servers)) {
        await check(`native ${live} vs ${template} dump`, () => expectClean(live, dumps[template], live === '8.0' && template === '8.0' ? ALL : COMMON));
    }
}
// 2. restore each dump on each server from empty
for (const template of Object.keys(servers)) for (const target of Object.keys(servers)) {
    const databases = restorable(template, target);
    await check(`restore ${template} dump on ${target}`, async () => {
        await reset(conns[target]);
        await update(target, dumps[template], databases);
        await expectClean(target, dumps[template], databases);
        assert.equal(count(await update(target, dumps[template], databases)), 0, 'second update is not a no-op');
        for (const other of Object.keys(servers)) if (other !== template) await expectClean(target, dumps[other], COMMON);
    });
    await check(`re-dump of ${template}->${target} restore matches native ${target}`, async () => {
        const dir = await dumpTo(target, path.join(artifacts, `redump-${template}-${target}`));
        await native(target);
        await expectClean(target, dir, COMMON);
    });
}
await check('8.0 expression defaults restored on 5.7 fail with the server error, not silently', async () => {
    await reset(conns['5.7']);
    await assert.rejects(() => update('5.7', dumps['8.0'], [DBX]), error => /missing_table expr/.test(error.message) && /SQL syntax/.test(error.message));
});
// 3. real drift is detected and repaired on both servers, against both dumps
const drift = [
    ['float precision', `ALTER TABLE numbers MODIFY f102 float DEFAULT NULL`],
    ['float to float(10,2)', `ALTER TABLE numbers MODIFY f float(10,2)`],
    ['text vs mediumtext', `ALTER TABLE strings MODIFY mt text`],
    ['nullable timestamp', `ALTER TABLE times MODIFY updated timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP`],
    ['lost ON UPDATE', `ALTER TABLE times MODIFY n_updated timestamp NULL DEFAULT CURRENT_TIMESTAMP`],
    ['comment', `ALTER TABLE numbers MODIFY baud int DEFAULT 19200 COMMENT 'drift'`],
    ['column order', `ALTER TABLE numbers MODIFY baud int DEFAULT 19200 AFTER id`],
    ['column charset', `ALTER TABLE strings MODIFY u8mb4 varchar(20) CHARACTER SET latin1 DEFAULT NULL`],
    ['table charset', `ALTER TABLE mb4_table DEFAULT CHARSET=latin1`],
    ['unsigned', `ALTER TABLE numbers MODIFY i_unsigned int`],
    ['tinyint(1) to tinyint', `ALTER TABLE numbers MODIFY ti1 tinyint(4) NOT NULL DEFAULT '0'`],
    ['default value', `ALTER TABLE numbers MODIFY baud int DEFAULT 9600`],
    ['table collation', `ALTER TABLE mb4_general COLLATE=utf8mb4_unicode_ci`],
    ['column collation', `ALTER TABLE col_general MODIFY c varchar(10) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin`],
    ['nullability', `ALTER TABLE strings MODIFY u8mb4_bin varchar(20) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NULL`],
    ['generated expression', `ALTER TABLE child MODIFY g_stored varchar(64) GENERATED ALWAYS AS (concat('q-', qty)) STORED`],
    ['trigger body', `DROP TRIGGER child_bi`, `CREATE TRIGGER child_bi BEFORE INSERT ON child FOR EACH ROW SET NEW.ref_code = IFNULL(NEW.ref_code, 'changed')`],
    ['trigger timing', `DROP TRIGGER child_bi`, `CREATE TRIGGER child_bi AFTER INSERT ON child FOR EACH ROW SET @x = 1`],
    ['view literal', `CREATE OR REPLACE VIEW child_view AS SELECT c.id, c.parent_id, p.name, CAST(c.id AS char CHARACTER SET utf8) AS idtext, 'LIT' AS lit, concat('a', p.name) AS joined FROM child c JOIN parent p ON p.id = c.parent_id WHERE p.name <> 'x'`],
    ['index columns', `ALTER TABLE child DROP INDEX multi, ADD INDEX multi (ref_code, parent_id)`],
    ['foreign key action', `ALTER TABLE child DROP FOREIGN KEY child_parent`, `ALTER TABLE child ADD CONSTRAINT child_parent FOREIGN KEY (parent_id) REFERENCES parent (id)`],
];
for (const live of Object.keys(servers)) for (const template of Object.keys(servers)) {
    for (const [label, ...statements] of drift) {
        await check(`drift "${label}" on ${live} vs ${template} dump is detected and repaired`, async () => {
            await native(live);
            await conns[live].query(`USE ${DB}`);
            for (const sql of statements) await conns[live].query(sql);
            const diffs = await compare(live, dumps[template]);
            assert.ok(count(diffs) > 0, 'drift was not detected');
            await update(live, dumps[template]);
            await expectClean(live, dumps[template]);
            return { detected: Object.values(diffs).flat().map(d => `${d.type}:${d.tableName || d.viewName || ''}${d.field ? '.' + d.field.Field : ''}:${(d.changes || []).join('+')}`) };
        });
    }
}
for (const c of Object.values(conns)) { await reset(c); await c.end(); }
await fs.writeFile(path.join(artifacts, 'cross-version-results.json'), JSON.stringify({ versions: Object.fromEntries(Object.entries(conns).map(([k, c]) => [k, c.version])), results }, null, 2));
const failed = results.filter(r => r.status === 'failed').length;
console.log(`${results.length - failed}/${results.length} passed. Evidence: ${path.join(artifacts, 'cross-version-results.json')}`);
