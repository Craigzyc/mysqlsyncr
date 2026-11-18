// Cross-version hunt: many small fixture groups, each created natively on a
// MySQL 5.7 and an 8.0 server, dumped by mysqlsyncr from each, then checked:
//   1. each native database compares clean against both dumps
//   2. each dump restores on both servers, compares clean, and a second update is a no-op
//   3. listed drift is detected and repaired against both dumps
// Groups with 8.0-only DDL check the 8.0 paths strictly and only REPORT what
// "8.0 dump restored on 5.7" does (INFO lines), since that may legitimately fail.
//
// Usage: node integration/cross-version-hunt.mjs --p57 34057 --p80 34080 [--password x] [--artifacts dir] [--only group,group]
// The servers must be throwaway containers: every database named h_* is dropped.
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
const only = arg('--only') ? arg('--only').split(',') : null;
const artifacts = path.resolve(arg('--artifacts') || await fs.mkdtemp(path.join(os.tmpdir(), 'mysqlsyncr-hunt-')));
await fs.mkdir(artifacts, { recursive: true });

const RELAXED = "ALLOW_INVALID_DATES,NO_ENGINE_SUBSTITUTION";

// Each group: common DDL (both servers), only80 DDL (8.0 only), drift [label, sql].
// nativeCross:false means the same DDL legitimately creates different schemas on
// the two versions (server defaults differ), so native cross comparisons are INFO.
const groups = [
    {
        name: 'views',
        common: [
            `CREATE TABLE base (id int NOT NULL, name varchar(20) DEFAULT NULL, amt decimal(10,2) DEFAULT NULL, status enum('a','b') DEFAULT 'a', PRIMARY KEY (id)) ENGINE=InnoDB DEFAULT CHARSET=latin1`,
            `CREATE TABLE u (id int NOT NULL, name varchar(20) DEFAULT NULL, PRIMARY KEY (id)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
            `CREATE VIEW v_literal AS SELECT id, 'abc' AS lit, "dq" AS dq, concat(name, '-x') AS c, '' AS emp, 'it''s' AS q FROM base`,
            `CREATE VIEW v_case AS SELECT id, CASE WHEN amt > 0 THEN 'pos' WHEN amt < 0 THEN 'neg' ELSE 'zero' END AS sign, CASE status WHEN 'a' THEN 1 ELSE 2 END AS st FROM base`,
            `CREATE VIEW v_sub AS SELECT id FROM base WHERE id IN (SELECT id FROM base WHERE name LIKE 'a%') AND EXISTS (SELECT 1 FROM u WHERE u.id = base.id)`,
            `CREATE VIEW v_union AS SELECT id, name FROM base UNION ALL SELECT id, name FROM u UNION SELECT 0, 'none'`,
            `CREATE VIEW v_convert AS SELECT CONVERT(name USING utf8mb4) AS n1, CAST(name AS CHAR(10) CHARACTER SET utf8mb4) AS n2, name COLLATE latin1_bin AS n3, CONVERT(name USING utf8) AS n4, _latin1'x' AS n5 FROM base`,
            `CREATE VIEW v_func AS SELECT status, date_format(now(), '%Y-%m') AS ym, ifnull(max(name), '') AS n, coalesce(sum(amt), 0) AS a, if(status = 'a', 1, 0) AS f, group_concat(name ORDER BY name SEPARATOR '; ') AS names, count(*) AS cnt FROM base GROUP BY status HAVING count(*) > 0`,
            "CREATE VIEW v_alias AS SELECT id AS `my id`, name AS `select`, amt AS `a``b` FROM base",
            `CREATE SQL SECURITY INVOKER VIEW v_invoker AS SELECT id FROM base`,
            `CREATE ALGORITHM=MERGE VIEW v_merge AS SELECT id, name FROM base WHERE amt > 10 WITH CASCADED CHECK OPTION`,
            `CREATE ALGORITHM=TEMPTABLE VIEW v_temptable AS SELECT DISTINCT name FROM base`,
            `CREATE VIEW v_utf8lit AS SELECT id FROM u WHERE name = 'é' OR name LIKE '%ü%'`,
            `CREATE VIEW z_base AS SELECT id, name FROM base`,
            `CREATE VIEW a_dep AS SELECT id FROM z_base`,
            `CREATE VIEW v_join AS SELECT b.id, u.name AS uname FROM base b LEFT JOIN u ON u.id = b.id AND u.name <> 'x' ORDER BY b.id DESC LIMIT 10`,
            `CREATE VIEW v_math AS SELECT id, amt * 1.5 AS m, -amt AS neg, amt DIV 2 AS d, amt % 3 AS md, 1e3 AS sci, 0x41 AS hex, b'1' AS bits, TRUE AS t, NULL AS nul FROM base`,
            `CREATE VIEW v_cols (c1, c2) AS SELECT id, name FROM base`,
        ],
        drift: [
            ['view literal changed', `CREATE OR REPLACE VIEW v_literal AS SELECT id, 'abd' AS lit, "dq" AS dq, concat(name, '-x') AS c, '' AS emp, 'it''s' AS q FROM base`],
            ['view security changed', `CREATE OR REPLACE SQL SECURITY DEFINER VIEW v_invoker AS SELECT id FROM base`],
            ['extra view', `CREATE VIEW v_extra AS SELECT 1 AS one`],
        ],
    },
    {
        name: 'routines',
        common: [
            `CREATE TABLE t (id int NOT NULL, name varchar(20) DEFAULT NULL, PRIMARY KEY (id)) ENGINE=InnoDB DEFAULT CHARSET=latin1`,
            `CREATE PROCEDURE p_chars(IN a varchar(10) CHARSET utf8mb4, IN b char(2) CHARACTER SET latin1, INOUT c text, OUT d decimal(10,2))
             COMMENT 'it''s a "proc"'
             LANGUAGE SQL
             DETERMINISTIC
             READS SQL DATA
             SQL SECURITY INVOKER
             BEGIN
                DECLARE x varchar(20) DEFAULT 'é';
                DECLARE done int DEFAULT 0;
                SELECT concat(a, 'lit', x) INTO c;
                SET d = 1.5;
             END`,
            `create procedure p_lower(in p int)
             modifies sql data
             begin
                update t set name = 'abc' where id = p;
                if p > 0 then select 'pos'; elseif p < 0 then select 'neg'; else select 'zero'; end if;
                while p > 0 do set p = p - 1; end while;
             end`,
            `CREATE PROCEDURE p_noparams() NO SQL SELECT 'x' AS x`,
            `CREATE PROCEDURE p_cursor()
             BEGIN
                DECLARE v int;
                DECLARE done int DEFAULT FALSE;
                DECLARE cur CURSOR FOR SELECT id FROM t;
                DECLARE CONTINUE HANDLER FOR NOT FOUND SET done = TRUE;
                OPEN cur;
                read_loop: LOOP FETCH cur INTO v; IF done THEN LEAVE read_loop; END IF; END LOOP;
                CLOSE cur;
                SELECT CONVERT('abc' USING utf8mb4), CAST('1' AS unsigned), _latin1'z';
             END`,
            `CREATE FUNCTION f_concat(s varchar(20) CHARSET utf8mb4) RETURNS varchar(30) CHARSET utf8mb4 DETERMINISTIC NO SQL RETURN concat('a', s)`,
            `CREATE FUNCTION f_reads(i int) RETURNS int READS SQL DATA SQL SECURITY INVOKER COMMENT 'fn' RETURN (SELECT count(*) FROM t WHERE id > i)`,
        ],
        drift: [
            ['procedure body changed', `DROP PROCEDURE p_noparams`, `CREATE PROCEDURE p_noparams() NO SQL SELECT 'y' AS x`],
            ['procedure security changed', `DROP PROCEDURE p_noparams`, `CREATE PROCEDURE p_noparams() NO SQL SQL SECURITY INVOKER SELECT 'x' AS x`],
            ['extra procedure', `CREATE PROCEDURE p_extra() SELECT 1`],
            ['missing procedure', `DROP PROCEDURE p_lower`],
            ['function body changed', `DROP FUNCTION f_concat`, `CREATE FUNCTION f_concat(s varchar(20) CHARSET utf8mb4) RETURNS varchar(30) CHARSET utf8mb4 DETERMINISTIC NO SQL RETURN concat('b', s)`],
            ['missing function', `DROP FUNCTION f_reads`],
        ],
    },
    {
        name: 'triggers',
        common: [
            `CREATE TABLE t (id int NOT NULL AUTO_INCREMENT, name varchar(20) DEFAULT NULL, cnt int NOT NULL DEFAULT 0, note varchar(50) DEFAULT NULL, PRIMARY KEY (id)) ENGINE=InnoDB DEFAULT CHARSET=latin1`,
            `CREATE TABLE log (id int NOT NULL AUTO_INCREMENT, msg varchar(100) DEFAULT NULL, PRIMARY KEY (id)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
            `CREATE TRIGGER tr_b BEFORE INSERT ON t FOR EACH ROW SET NEW.cnt = NEW.cnt + 1`,
            `CREATE TRIGGER tr_c BEFORE INSERT ON t FOR EACH ROW FOLLOWS tr_b SET NEW.cnt = NEW.cnt * 2`,
            `CREATE TRIGGER tr_a BEFORE INSERT ON t FOR EACH ROW PRECEDES tr_b SET NEW.note = 'first'`,
            `CREATE TRIGGER tr_multi AFTER INSERT ON t FOR EACH ROW
             BEGIN
                DECLARE m varchar(100);
                IF NEW.name IS NULL THEN
                    SET m = concat('null name ', NEW.id);
                ELSE
                    SET m = concat('name ', NEW.name, ' é');
                END IF;
                INSERT INTO log (msg) VALUES (m);
             END`,
            `create trigger tr_lower before update on t for each row set new.note = 'upd'`,
            "CREATE TRIGGER `tr quoted` AFTER DELETE ON `t` FOR EACH ROW INSERT INTO log (msg) VALUES (CONVERT(OLD.name USING utf8mb4))",
        ],
        drift: [
            ['trigger body changed', `DROP TRIGGER tr_lower`, `create trigger tr_lower before update on t for each row set new.note = 'UPD'`],
            ['missing trigger', `DROP TRIGGER tr_multi`],
            ['extra trigger', `CREATE TRIGGER tr_extra AFTER UPDATE ON t FOR EACH ROW SET @x = 1`],
            ['trigger order changed', `DROP TRIGGER tr_c`, `CREATE TRIGGER tr_c BEFORE INSERT ON t FOR EACH ROW PRECEDES tr_a SET NEW.cnt = NEW.cnt * 2`],
        ],
    },
    {
        name: 'defaults',
        common: [
            `CREATE TABLE d (
                id int NOT NULL,
                e_empty enum('','a','b') NOT NULL DEFAULT '',
                e_implicit enum('x','y') NOT NULL,
                e_null enum('x','y'),
                s_empty set('','p','q') DEFAULT '',
                s_multi set('p','q','r') DEFAULT 'p,r',
                dec0 decimal(10,2) NOT NULL DEFAULT 0,
                dec_neg decimal(6,3) DEFAULT -1.5,
                dec_str decimal(8,2) DEFAULT '12.5',
                f_neg float DEFAULT -1.5,
                f_sci double DEFAULT 1e3,
                f_small double DEFAULT 0.000001,
                i_str int DEFAULT '010',
                i_neg bigint DEFAULT -9223372036854775808,
                u_max int unsigned DEFAULT 4294967295,
                bit1 bit(1) DEFAULT b'1',
                bit3 bit(3) DEFAULT b'101',
                bit8 bit(8) DEFAULT 5,
                bit_hex bit(8) DEFAULT 0x0F,
                vc_bs varchar(20) DEFAULT 'a\\\\b',
                vc_nl varchar(20) DEFAULT 'line\\nbreak',
                vc_tab varchar(20) DEFAULT 'tab\\there',
                vc_pct varchar(20) DEFAULT '50%_x',
                vc_quote varchar(20) DEFAULT 'say "hi"',
                vc_null_word varchar(20) DEFAULT 'NULL',
                vc_ct varchar(30) DEFAULT 'CURRENT_TIMESTAMP',
                vc_space varchar(20) DEFAULT ' lead',
                vc_utf varchar(20) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT 'é€',
                ch_pad char(5) DEFAULT 'ab',
                bin_pad binary(4) DEFAULT 'ab',
                vb_hex varbinary(8) DEFAULT 0x4142,
                vb_str varbinary(8) DEFAULT 'xy',
                dt datetime DEFAULT '2020-01-01 00:00:00',
                dt6 datetime(6) DEFAULT '2020-01-01 00:00:00.123456',
                dt_short datetime DEFAULT '2020-1-2',
                d_date date DEFAULT '2020-02-29',
                tm3 time(3) DEFAULT '12:34:56.789',
                tm_neg time DEFAULT '-01:00:00',
                yr year DEFAULT 2024,
                ts_explicit timestamp NULL DEFAULT '2020-01-01 00:00:00',
                PRIMARY KEY (id)
            ) ENGINE=InnoDB DEFAULT CHARSET=latin1`,
            `CREATE TABLE cs_binary (
                id int NOT NULL,
                vc_bin varchar(10) CHARACTER SET binary DEFAULT NULL,
                ch_bin char(4) CHARACTER SET binary DEFAULT NULL,
                tx_bin text CHARACTER SET binary,
                nc nchar(10) DEFAULT NULL,
                nvc nvarchar(10) DEFAULT NULL,
                nat national varchar(10) DEFAULT NULL,
                ncv national character varying(10) DEFAULT NULL,
                vc_byte varchar(10) BINARY DEFAULT NULL,
                ascii_c varchar(10) ASCII DEFAULT NULL,
                uni_c varchar(10) UNICODE DEFAULT NULL,
                PRIMARY KEY (id)
            ) ENGINE=InnoDB DEFAULT CHARSET=latin1`,
            `CREATE TABLE utf8_mixed (id int NOT NULL, a varchar(10), b varchar(10) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci, d text CHARACTER SET latin1 COLLATE latin1_general_cs, e varchar(10) COLLATE utf8_bin, PRIMARY KEY (id)) ENGINE=InnoDB DEFAULT CHARSET=utf8`,
            `CREATE TABLE ucs (id int NOT NULL, a varchar(10) CHARACTER SET ucs2, b varchar(10) CHARACTER SET utf16, c varchar(10) CHARACTER SET cp1251, PRIMARY KEY (id)) ENGINE=InnoDB DEFAULT CHARSET=latin1`,
        ],
        drift: [
            ['enum default', `ALTER TABLE d MODIFY e_empty enum('','a','b') NOT NULL DEFAULT 'a'`],
            ['enum values', `ALTER TABLE d MODIFY e_null enum('x','y','z')`],
            ['bit default', `ALTER TABLE d MODIFY bit3 bit(3) DEFAULT b'100'`],
            ['decimal default', `ALTER TABLE d MODIFY dec0 decimal(10,2) NOT NULL DEFAULT 1`],
            ['string default with backslash', `ALTER TABLE d MODIFY vc_bs varchar(20) DEFAULT 'a/b'`],
            ['default NULL word vs NULL', `ALTER TABLE d MODIFY vc_null_word varchar(20) DEFAULT NULL`],
            ['binary pad default', `ALTER TABLE d MODIFY bin_pad binary(4) DEFAULT 'ac'`],
            ['datetime precision', `ALTER TABLE d MODIFY dt6 datetime(3) DEFAULT '2020-01-01 00:00:00.123'`],
            ['charset binary to latin1', `ALTER TABLE cs_binary MODIFY vc_bin varchar(10) DEFAULT NULL`],
            ['collation in utf8 table', `ALTER TABLE utf8_mixed MODIFY e varchar(10) COLLATE utf8_general_ci`],
            ['explicit charset to table default', `ALTER TABLE utf8_mixed MODIFY b varchar(10)`],
        ],
    },
    {
        name: 'tableopts',
        common: [
            `CREATE TABLE rf_dyn (id int NOT NULL, PRIMARY KEY (id)) ENGINE=InnoDB ROW_FORMAT=DYNAMIC DEFAULT CHARSET=latin1`,
            `CREATE TABLE rf_compact (id int NOT NULL, PRIMARY KEY (id)) ENGINE=InnoDB ROW_FORMAT=COMPACT DEFAULT CHARSET=latin1`,
            `CREATE TABLE rf_comp (id int NOT NULL, PRIMARY KEY (id)) ENGINE=InnoDB ROW_FORMAT=COMPRESSED KEY_BLOCK_SIZE=8 DEFAULT CHARSET=latin1`,
            `CREATE TABLE commented (id int NOT NULL, PRIMARY KEY (id)) ENGINE=InnoDB DEFAULT CHARSET=latin1 COMMENT='table ''comment'' with, commas (parens)'`,
            `CREATE TABLE ai_start (id int NOT NULL AUTO_INCREMENT, PRIMARY KEY (id)) ENGINE=InnoDB AUTO_INCREMENT=1000 DEFAULT CHARSET=latin1`,
            `CREATE TABLE stats (id int NOT NULL, PRIMARY KEY (id)) ENGINE=InnoDB DEFAULT CHARSET=latin1 STATS_PERSISTENT=0 STATS_AUTO_RECALC=1 STATS_SAMPLE_PAGES=25`,
            `CREATE TABLE part_range (id int NOT NULL, y int NOT NULL, PRIMARY KEY (id, y)) ENGINE=InnoDB DEFAULT CHARSET=latin1
             PARTITION BY RANGE (y) (PARTITION p2019 VALUES LESS THAN (2020), PARTITION p2020 VALUES LESS THAN (2021), PARTITION pmax VALUES LESS THAN MAXVALUE)`,
            `CREATE TABLE part_hash (id int NOT NULL, PRIMARY KEY (id)) ENGINE=InnoDB DEFAULT CHARSET=latin1 PARTITION BY HASH (id) PARTITIONS 4`,
            `CREATE TABLE part_key (id int NOT NULL, c varchar(10) NOT NULL, PRIMARY KEY (id, c)) ENGINE=InnoDB DEFAULT CHARSET=latin1 PARTITION BY KEY (c) PARTITIONS 3`,
            `CREATE TABLE part_list (id int NOT NULL, region int NOT NULL, PRIMARY KEY (id, region)) ENGINE=InnoDB DEFAULT CHARSET=latin1 PARTITION BY LIST (region) (PARTITION pa VALUES IN (1,2), PARTITION pb VALUES IN (3))`,
            `CREATE TABLE mem (id int NOT NULL, k varchar(10) DEFAULT NULL, PRIMARY KEY (id), KEY k (k)) ENGINE=MEMORY DEFAULT CHARSET=latin1`,
            `CREATE TABLE myi (id int NOT NULL, v varchar(10) DEFAULT NULL, PRIMARY KEY (id)) ENGINE=MyISAM DEFAULT CHARSET=latin1 PACK_KEYS=1 CHECKSUM=1 DELAY_KEY_WRITE=1`,
            `CREATE TABLE no_pk (a int DEFAULT NULL, b int DEFAULT NULL) ENGINE=InnoDB DEFAULT CHARSET=latin1`,
            `CREATE TABLE mb4_bin (id int NOT NULL, v varchar(10), PRIMARY KEY (id)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin`,
        ],
        drift: [
            ['table comment', `ALTER TABLE commented COMMENT='other'`],
            ['row format', `ALTER TABLE rf_dyn ROW_FORMAT=COMPACT`],
            ['key block size', `ALTER TABLE rf_comp KEY_BLOCK_SIZE=4`],
            ['partitions removed', `ALTER TABLE part_hash REMOVE PARTITIONING`],
            ['partition count', `ALTER TABLE part_hash COALESCE PARTITION 2`],
            ['range partition boundaries', `ALTER TABLE part_range REORGANIZE PARTITION pmax INTO (PARTITION p2021 VALUES LESS THAN (2022), PARTITION pmax VALUES LESS THAN MAXVALUE)`],
            ['engine', `ALTER TABLE myi ENGINE=InnoDB`],
        ],
    },
    {
        name: 'keys',
        common: [
            `CREATE TABLE geo (id int NOT NULL, g geometry NOT NULL, p point NOT NULL, ls linestring DEFAULT NULL, poly polygon DEFAULT NULL, mp multipoint DEFAULT NULL, PRIMARY KEY (id), SPATIAL KEY g (g), SPATIAL INDEX sp_p (p)) ENGINE=InnoDB DEFAULT CHARSET=latin1`,
            `CREATE TABLE idx (id int NOT NULL, a int DEFAULT NULL, b varchar(20) DEFAULT NULL, c varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL, d text,
                PRIMARY KEY (id) USING BTREE, KEY k_btree (a) USING BTREE, KEY k_hash (b), INDEX k_pre_using USING BTREE (a, b),
                KEY k_prefix (c(191)), KEY k_prefix_text (d(50), a), UNIQUE KEY uq_nullable (a, b), KEY k_comment (b) COMMENT 'index ''comment''',
                KEY k_asc (a ASC, b ASC), KEY k_dup (a), KEY k_dup2 (a)) ENGINE=InnoDB DEFAULT CHARSET=latin1`,
            "CREATE TABLE reserved (`order` int NOT NULL, `key` varchar(10) DEFAULT NULL, `select` int DEFAULT NULL, `my col` int DEFAULT NULL, `a``b` int DEFAULT NULL, `dash-col` int DEFAULT NULL, `ÿ` int DEFAULT NULL, `123` int DEFAULT NULL, PRIMARY KEY (`order`), KEY `key` (`key`), KEY `my idx` (`my col`), KEY `tick``idx` (`a``b`)) ENGINE=InnoDB DEFAULT CHARSET=latin1",
            "CREATE TABLE `my table` (id int NOT NULL, `group` int DEFAULT NULL, PRIMARY KEY (id)) ENGINE=InnoDB DEFAULT CHARSET=latin1",
            "CREATE TABLE `order` (id int NOT NULL, PRIMARY KEY (id)) ENGINE=InnoDB DEFAULT CHARSET=latin1",
            "CREATE TABLE `t-dash` (id int NOT NULL, PRIMARY KEY (id)) ENGINE=InnoDB DEFAULT CHARSET=latin1",
            `CREATE TABLE ai_unique (id int NOT NULL, seq int NOT NULL AUTO_INCREMENT, PRIMARY KEY (id), UNIQUE KEY seq (seq)) ENGINE=InnoDB DEFAULT CHARSET=latin1`,
            `CREATE TABLE ai_composite (a int NOT NULL AUTO_INCREMENT, b int NOT NULL, PRIMARY KEY (a, b)) ENGINE=InnoDB DEFAULT CHARSET=latin1`,
            `CREATE TABLE fk_parent (id int NOT NULL, code varchar(10) NOT NULL, region int NOT NULL, PRIMARY KEY (id), UNIQUE KEY code (code), UNIQUE KEY multi (id, region)) ENGINE=InnoDB DEFAULT CHARSET=latin1`,
            `CREATE TABLE fk_child (id int NOT NULL, parent_id int DEFAULT NULL, code varchar(10) DEFAULT NULL, pid int DEFAULT NULL, region int DEFAULT NULL, other_id int DEFAULT NULL, manager_id int DEFAULT NULL,
                PRIMARY KEY (id), KEY manager_id (manager_id),
                CONSTRAINT fk_setnull FOREIGN KEY (parent_id) REFERENCES fk_parent (id) ON DELETE SET NULL ON UPDATE CASCADE,
                CONSTRAINT fk_code FOREIGN KEY (code) REFERENCES fk_parent (code) ON DELETE RESTRICT ON UPDATE RESTRICT,
                CONSTRAINT fk_multi FOREIGN KEY (pid, region) REFERENCES fk_parent (id, region) ON DELETE CASCADE,
                CONSTRAINT fk_self FOREIGN KEY (manager_id) REFERENCES fk_child (id) ON DELETE SET NULL,
                FOREIGN KEY (other_id) REFERENCES fk_parent (id)) ENGINE=InnoDB DEFAULT CHARSET=latin1`,
            "CREATE TABLE `fk to quoted` (id int NOT NULL, ref int DEFAULT NULL, PRIMARY KEY (id), CONSTRAINT `fk quoted` FOREIGN KEY (ref) REFERENCES `my table` (id)) ENGINE=InnoDB DEFAULT CHARSET=latin1",
            `CREATE TABLE ft (id int NOT NULL, a text, b varchar(100) DEFAULT NULL, PRIMARY KEY (id), FULLTEXT KEY ft_ab (a, b), FULLTEXT KEY ft_b (b) WITH PARSER ngram) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
        ],
        drift: [
            ['FK action SET NULL to CASCADE', `ALTER TABLE fk_child DROP FOREIGN KEY fk_setnull`, `ALTER TABLE fk_child ADD CONSTRAINT fk_setnull FOREIGN KEY (parent_id) REFERENCES fk_parent (id) ON DELETE CASCADE ON UPDATE CASCADE`],
            ['FK RESTRICT to NO ACTION spelled', `ALTER TABLE fk_child DROP FOREIGN KEY fk_code`, `ALTER TABLE fk_child ADD CONSTRAINT fk_code FOREIGN KEY (code) REFERENCES fk_parent (code) ON DELETE CASCADE`],
            ['FK renamed', `ALTER TABLE fk_child DROP FOREIGN KEY fk_self`, `ALTER TABLE fk_child ADD CONSTRAINT fk_self2 FOREIGN KEY (manager_id) REFERENCES fk_child (id) ON DELETE SET NULL`],
            ['multi-column FK dropped', `ALTER TABLE fk_child DROP FOREIGN KEY fk_multi`],
            ['self FK dropped', `ALTER TABLE fk_child DROP FOREIGN KEY fk_self`],
            ['prefix length', `ALTER TABLE idx DROP INDEX k_prefix, ADD KEY k_prefix (c(100))`],
            ['index comment', `ALTER TABLE idx DROP INDEX k_comment, ADD KEY k_comment (b) COMMENT 'changed'`],
            ['unique to non-unique', `ALTER TABLE idx DROP INDEX uq_nullable, ADD KEY uq_nullable (a, b)`],
            ['duplicate index dropped', `ALTER TABLE idx DROP INDEX k_dup2`],
            ['index column order', `ALTER TABLE idx DROP INDEX k_pre_using, ADD INDEX k_pre_using (b, a)`],
            ['spatial index dropped', `ALTER TABLE geo DROP INDEX sp_p`],
            ['geometry type', `ALTER TABLE geo MODIFY ls geometry DEFAULT NULL`],
            ['backtick column type', "ALTER TABLE reserved MODIFY `a``b` bigint DEFAULT NULL"],
            ['spaced column type', "ALTER TABLE reserved MODIFY `my col` bigint DEFAULT NULL"],
            ['reserved column dropped', "ALTER TABLE reserved DROP COLUMN `select`"],
            ['quoted table column', "ALTER TABLE `my table` MODIFY `group` varchar(5)"],
            ['auto_increment on unique removed', `ALTER TABLE ai_unique MODIFY seq int NOT NULL`],
            ['fulltext parser', `ALTER TABLE ft DROP INDEX ft_b, ADD FULLTEXT KEY ft_b (b)`],
        ],
    },
    {
        // 5.7 defaults explicit_defaults_for_timestamp=OFF, 8.0 defaults ON, so the
        // same bare-timestamp DDL creates different columns. Native cross results are INFO.
        name: 'timestamps',
        nativeCross: false,
        common: [
            `CREATE TABLE ts (id int NOT NULL, ts1 timestamp, ts_null timestamp NULL, ts_def timestamp DEFAULT CURRENT_TIMESTAMP, dt datetime, PRIMARY KEY (id)) ENGINE=InnoDB DEFAULT CHARSET=latin1`,
        ],
        drift: [],
    },
    {
        // A second bare timestamp under explicit_defaults_for_timestamp=OFF gets
        // DEFAULT '0000-00-00 00:00:00', which strict-mode servers reject when restated.
        name: 'zerots57',
        nativeCross: false,
        common: [
            { sqlMode: RELAXED, sql: `CREATE TABLE ts2 (id int NOT NULL, created timestamp, updated timestamp, PRIMARY KEY (id)) ENGINE=InnoDB DEFAULT CHARSET=latin1` },
        ],
        drift: [],
    },
    {
        name: 'zerodates',
        common: [
            { sqlMode: RELAXED, sql: `CREATE TABLE zd (id int NOT NULL, d date NOT NULL DEFAULT '0000-00-00', dt datetime NOT NULL DEFAULT '0000-00-00 00:00:00', ts timestamp NOT NULL DEFAULT '0000-00-00 00:00:00', PRIMARY KEY (id)) ENGINE=InnoDB DEFAULT CHARSET=latin1` },
        ],
        drift: [
            ['zero date to real date', `ALTER TABLE zd MODIFY d date NOT NULL DEFAULT '2000-01-01'`, null, RELAXED],
        ],
    },
    {
        // utf8mb4 with the charset's default collation: 5.7 omits COLLATE (general_ci
        // is its default), 8.0 prints it (0900_ai_ci is its default). Identical
        // schemas must compare clean; an explicit general_ci must survive a restore.
        name: 'mb4_default',
        common: [
            `CREATE TABLE mb4_general (id int NOT NULL, v varchar(10), PRIMARY KEY (id)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci`,
            `CREATE TABLE col_general (id int NOT NULL, c varchar(10) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci, PRIMARY KEY (id)) ENGINE=InnoDB DEFAULT CHARSET=latin1`,
        ],
        drift: [
            ['table default collation', `ALTER TABLE mb4_general COLLATE=utf8mb4_unicode_ci`],
            ['column general to unicode', `ALTER TABLE col_general MODIFY c varchar(10) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`],
        ],
    },
    {
        // The same DDL; collation follows each server's default, so native results are INFO.
        name: 'mb4_implicit',
        nativeCross: false,
        common: [
            `CREATE TABLE implicit_t (id int NOT NULL, v varchar(10), PRIMARY KEY (id)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
            `CREATE TABLE implicit_col (id int NOT NULL, c varchar(10) CHARACTER SET utf8mb4, PRIMARY KEY (id)) ENGINE=InnoDB DEFAULT CHARSET=latin1`,
        ],
        drift: [],
    },
    {
        name: 'ft_collation',
        common: [
            `CREATE TABLE ft (id int NOT NULL, a text, b varchar(100) DEFAULT NULL, PRIMARY KEY (id), FULLTEXT KEY ft_ab (a, b)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
        ],
        drift: [
            ['fulltext columns collation', `ALTER TABLE ft CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_bin`],
            ['fulltext columns charset', `ALTER TABLE ft CONVERT TO CHARACTER SET latin1`],
        ],
    },
    {
        name: 'hash_index',
        common: [
            `CREATE TABLE idx (id int NOT NULL, b varchar(20) DEFAULT NULL, PRIMARY KEY (id), KEY k_hash (b) USING HASH) ENGINE=InnoDB DEFAULT CHARSET=latin1`,
            `CREATE TABLE mem (id int NOT NULL, b varchar(20) DEFAULT NULL, PRIMARY KEY (id), KEY k_bt (b) USING BTREE, KEY k_def (b)) ENGINE=MEMORY DEFAULT CHARSET=latin1`,
        ],
        drift: [
            ['memory btree to hash', `ALTER TABLE mem DROP INDEX k_bt, ADD KEY k_bt (b) USING HASH`],
        ],
    },
    {
        name: 'geomcoll',
        common: [
            `CREATE TABLE geo (id int NOT NULL, gc geometrycollection DEFAULT NULL, PRIMARY KEY (id)) ENGINE=InnoDB DEFAULT CHARSET=latin1`,
        ],
        drift: [
            ['geometrycollection to geometry', `ALTER TABLE geo MODIFY gc geometry DEFAULT NULL`],
        ],
    },
    // ---- 8.0-only features, one group each so failures stay isolated ----
    {
        name: 'e_default_expr',
        common: [`CREATE TABLE anchor (id int NOT NULL, PRIMARY KEY (id)) ENGINE=InnoDB DEFAULT CHARSET=latin1`],
        only80: [
            `CREATE TABLE dx (id int NOT NULL, j json DEFAULT (json_array()), jo json DEFAULT (json_object('k', 'v')), u char(36) DEFAULT (uuid()), ub binary(16) DEFAULT (uuid_to_bin(uuid())),
                tx text DEFAULT ('abc'), bl blob DEFAULT ('x'), d date DEFAULT (curdate() + interval 1 day), n int DEFAULT (1 + 1), s varchar(20) DEFAULT (concat('a', 'b')), PRIMARY KEY (id)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
        ],
        drift: [
            ['expression default changed', `ALTER TABLE dx ALTER COLUMN n SET DEFAULT (2 + 2)`, null, null, '8.0'],
            ['expression default text', `ALTER TABLE dx MODIFY tx text DEFAULT ('abd')`, null, null, '8.0'],
            ['expression default dropped', `ALTER TABLE dx ALTER COLUMN j DROP DEFAULT`, null, null, '8.0'],
        ],
    },
    {
        name: 'e_desc_index',
        common: [`CREATE TABLE anchor (id int NOT NULL, PRIMARY KEY (id)) ENGINE=InnoDB DEFAULT CHARSET=latin1`],
        only80: [`CREATE TABLE di (id int NOT NULL, a int DEFAULT NULL, b int DEFAULT NULL, PRIMARY KEY (id), KEY k_desc (a DESC), KEY k_mixed (a, b DESC)) ENGINE=InnoDB DEFAULT CHARSET=latin1`],
        drift: [
            ['desc to asc', `ALTER TABLE di DROP INDEX k_desc, ADD KEY k_desc (a)`, null, null, '8.0'],
            ['mixed order changed', `ALTER TABLE di DROP INDEX k_mixed, ADD KEY k_mixed (a DESC, b)`, null, null, '8.0'],
        ],
    },
    {
        name: 'e_func_index',
        common: [`CREATE TABLE anchor (id int NOT NULL, PRIMARY KEY (id)) ENGINE=InnoDB DEFAULT CHARSET=latin1`],
        only80: [`CREATE TABLE fi (id int NOT NULL, name varchar(20) DEFAULT NULL, j json DEFAULT NULL, PRIMARY KEY (id), KEY k_lower ((lower(name))), KEY k_mixed (id, (abs(id))), KEY k_json ((cast(j->>'$.x' as char(10)))), UNIQUE KEY uq_upper ((upper(name)))) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`],
        drift: [
            ['functional expression changed', `ALTER TABLE fi DROP INDEX k_lower, ADD KEY k_lower ((upper(name)))`, null, null, '8.0'],
            ['functional index dropped', `ALTER TABLE fi DROP INDEX k_json`, null, null, '8.0'],
        ],
    },
    {
        name: 'e_check',
        common: [`CREATE TABLE anchor (id int NOT NULL, PRIMARY KEY (id)) ENGINE=InnoDB DEFAULT CHARSET=latin1`],
        only80: [`CREATE TABLE ck (id int NOT NULL, qty int DEFAULT NULL CHECK (qty > 0), s varchar(10) DEFAULT NULL, PRIMARY KEY (id), CONSTRAINT ck_s CHECK (s <> 'bad'), CONSTRAINT ck_ne CHECK (id < 1000) NOT ENFORCED) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`],
        drift: [
            ['check dropped', `ALTER TABLE ck DROP CHECK ck_s`, null, null, '8.0'],
            ['check expression changed', `ALTER TABLE ck DROP CHECK ck_s, ADD CONSTRAINT ck_s CHECK (s <> 'worse')`, null, null, '8.0'],
            ['check enforcement changed', `ALTER TABLE ck ALTER CHECK ck_ne ENFORCED`, null, null, '8.0'],
        ],
    },
    {
        name: 'e_0900',
        common: [`CREATE TABLE anchor (id int NOT NULL, PRIMARY KEY (id)) ENGINE=InnoDB DEFAULT CHARSET=latin1`],
        only80: [`CREATE TABLE c9 (id int NOT NULL, as_cs varchar(10) COLLATE utf8mb4_0900_as_cs DEFAULT NULL, as_ci varchar(10) COLLATE utf8mb4_0900_as_ci DEFAULT NULL, de varchar(10) COLLATE utf8mb4_de_pb_0900_ai_ci DEFAULT NULL, PRIMARY KEY (id), UNIQUE KEY u_as_cs (as_cs)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_as_cs`],
        drift: [
            ['0900 as_cs to ai_ci', `ALTER TABLE c9 MODIFY as_cs varchar(10) COLLATE utf8mb4_0900_ai_ci DEFAULT NULL`, null, null, '8.0'],
        ],
    },
    {
        name: 'e_invisible_col',
        common: [`CREATE TABLE anchor (id int NOT NULL, PRIMARY KEY (id)) ENGINE=InnoDB DEFAULT CHARSET=latin1`],
        only80: [`CREATE TABLE ic (id int NOT NULL, secret varchar(10) DEFAULT NULL INVISIBLE, PRIMARY KEY (id)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`],
        drift: [
            ['invisible to visible', `ALTER TABLE ic ALTER COLUMN secret SET VISIBLE`, null, null, '8.0'],
        ],
    },
    {
        name: 'e_srid',
        common: [`CREATE TABLE anchor (id int NOT NULL, PRIMARY KEY (id)) ENGINE=InnoDB DEFAULT CHARSET=latin1`],
        only80: [`CREATE TABLE sr (id int NOT NULL, g geometry NOT NULL SRID 4326, p point NOT NULL SRID 0, PRIMARY KEY (id), SPATIAL KEY g (g)) ENGINE=InnoDB DEFAULT CHARSET=latin1`],
        drift: [
            ['srid changed', `ALTER TABLE sr MODIFY p point NOT NULL SRID 4326`, null, null, '8.0'],
        ],
    },
    {
        name: 'e_misc80',
        common: [`CREATE TABLE anchor (id int NOT NULL, PRIMARY KEY (id)) ENGINE=InnoDB DEFAULT CHARSET=latin1`],
        only80: [
            `CREATE TABLE m8 (id int NOT NULL, g varchar(30) GENERATED ALWAYS AS (concat(_utf8mb4'x', id)) VIRTUAL, PRIMARY KEY (id), KEY k_inv (g) INVISIBLE) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
            `CREATE TABLE enc (id int NOT NULL, PRIMARY KEY (id)) ENGINE=InnoDB DEFAULT CHARSET=latin1 STATS_PERSISTENT=1`,
            `CREATE VIEW v_cte AS WITH x AS (SELECT id FROM anchor) SELECT id, row_number() OVER (ORDER BY id) AS rn FROM x`,
        ],
        drift: [],
    },
];

const servers = { '5.7': Number(arg('--p57', 34057)), '8.0': Number(arg('--p80', 34080)) };
const connect = async port => {
    for (let attempt = 0; ; attempt++) {
        try { return await mysql.createConnection({ host: '127.0.0.1', port, user: 'root', password, multipleStatements: false }); }
        catch (error) { if (attempt > 120) throw error; await new Promise(r => setTimeout(r, 1000)); }
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
const clip = s => typeof s === 'string' ? s.replace(/\s+/g, ' ').slice(0, 400) : s;
const summarize = diffs => Object.values(diffs).flat().map(d => ({
    type: d.type, table: d.tableName || d.Name || d.viewName, field: d.field?.Field, index: d.indexName, constraint: d.constraintName, trigger: d.trigger?.Name,
    changes: d.changes, expected: d.field && { Type: d.field.Type, Default: d.field.Default, NotNull: d.field.NotNull, Charset: d.field.Charset, Collate: d.field.Collate },
    current: d.currentField && { Type: d.currentField.Type, Default: d.currentField.Default, NotNull: d.currentField.NotNull, Charset: d.currentField.Charset, Collate: d.currentField.Collate },
    expIndex: d.index?.ColumnName, curIndex: d.currentIndex?.ColumnName, options: d.options, currentOptions: d.currentOptions,
    expDef: clip(d.definition || d.Definition || d.trigger?.Definition), curDef: clip(d.current || d.currentDefinition || d.currentTrigger?.Definition),
}));

const resetAll = async c => {
    await c.query('SET FOREIGN_KEY_CHECKS=0');
    const [rows] = await c.query("SELECT schema_name AS d FROM information_schema.schemata WHERE schema_name LIKE 'h\\_%'");
    for (const { d } of rows) await c.query(`DROP DATABASE \`${d}\``);
    await c.query('SET FOREIGN_KEY_CHECKS=1');
    await c.query('SET SESSION sql_mode = DEFAULT');
    // mysqlsyncr's update leaves explicit_defaults_for_timestamp=1 on the session;
    // fixtures must be created with the server's own default.
    await c.query('SET SESSION explicit_defaults_for_timestamp = DEFAULT');
};
const runStatement = async (c, stmt) => {
    const { sql, sqlMode } = typeof stmt === 'string' ? { sql: stmt } : stmt;
    if (sqlMode) await c.query(`SET SESSION sql_mode = '${sqlMode}'`);
    try { await c.query(sql); } finally { if (sqlMode) await c.query('SET SESSION sql_mode = DEFAULT'); }
};
const native = async (g, name) => {
    const c = conns[name];
    await resetAll(c);
    await c.query(`CREATE DATABASE h_${g.name} DEFAULT CHARACTER SET latin1`);
    await c.query(`USE h_${g.name}`);
    for (const stmt of [...g.common, ...(name === '8.0' ? g.only80 || [] : [])]) {
        try { await runStatement(c, stmt); } catch (error) { throw new Error(`${name} rejected fixture DDL: ${error.message}\n${stmt.sql || stmt}`); }
    }
};

let current;
const check = async (label, fn, { info = false } = {}) => {
    const full = `[${current}] ${label}`;
    try {
        const detail = await fn();
        results.push({ label: full, status: info ? 'info' : 'passed', ...(detail || {}) });
        console.log(`${info ? 'INFO' : 'PASS'} ${full}${info && detail ? '\n  ' + JSON.stringify(detail).slice(0, 3000) : ''}`);
    } catch (error) {
        results.push({ label: full, status: info ? 'info-error' : 'failed', error: error.message, differences: error.differences && summarize(error.differences) });
        console.log(`${info ? 'INFO' : 'FAIL'} ${full}\n  ${error.message.split('\n').join('\n  ').slice(0, 4000)}`);
        if (!info) process.exitCode = 1;
    }
};
const differenceError = diffs => {
    const error = new Error(`${count(diffs)} differences: ${JSON.stringify(summarize(diffs), null, 1)}`);
    error.differences = diffs;
    return error;
};

for (const g of groups) {
    if (only && !only.includes(g.name)) continue;
    current = g.name;
    const DB = `h_${g.name}`;
    const has80only = !!g.only80?.length;
    const scope = { database: DB };
    const compare = (name, dir) => quiet(() => compareAllDatabases(adapter(conns[name]), dir, false, 'compare', { quiet: true, ...scope }));
    const update = (name, dir) => quiet(() => compareAllDatabases(adapter(conns[name]), dir, true, 'update', { quiet: true, ...scope }));
    const expectClean = async (name, dir) => { const diffs = await compare(name, dir); if (count(diffs)) throw differenceError(diffs); };
    const dumpTo = async (name, dir) => {
        await fs.rm(dir, { recursive: true, force: true });
        await fs.mkdir(dir, { recursive: true });
        await quiet(() => dumpAllDatabases(adapter(conns[name]), 'dump', { output: dir, database: DB }));
    };
    // 5.7 holds no 8.0-only objects, so those groups only compare like with like.
    const comparable = (live, template) => !(has80only && live !== template);

    const dumps = {};
    try {
        for (const name of Object.keys(servers)) {
            await native(g, name);
            dumps[name] = path.join(artifacts, g.name, `dump-${name}`);
            await dumpTo(name, dumps[name]);
        }
    } catch (error) {
        await check('fixture', () => { throw error; });
        continue;
    }
    // 1. native vs both dumps
    for (const live of Object.keys(servers)) {
        await native(g, live);
        for (const template of Object.keys(servers)) {
            if (!comparable(live, template)) continue;
            const info = g.nativeCross === false && live !== template;
            await check(`native ${live} vs ${template} dump`, async () => {
                const diffs = await compare(live, dumps[template]);
                if (info) return { differences: summarize(diffs) };
                if (count(diffs)) throw differenceError(diffs);
            }, { info });
        }
    }
    // 2. restore each dump on each server
    for (const template of Object.keys(servers)) for (const target of Object.keys(servers)) {
        const info = has80only && template === '8.0' && target === '5.7';
        await check(`restore ${template} dump on ${target}`, async () => {
            await resetAll(conns[target]);
            let restoreError = null;
            try { await update(target, dumps[template]); } catch (error) { restoreError = error; if (!info) throw error; }
            if (info) {
                const after = await compare(target, dumps[template]).catch(e => ({ error: [e.message] }));
                let second = null;
                try { second = count(await update(target, dumps[template])); } catch (e) { second = `error: ${e.message.slice(0, 300)}`; }
                const third = await compare(target, dumps[template]).catch(() => ({}));
                return { restoreError: restoreError?.message?.slice(0, 1200), remainingAfterRestore: summarize(after), secondUpdateApplied: second, remainingAfterSecond: count(third) };
            }
            await expectClean(target, dumps[template]);
            const second = await update(target, dumps[template]);
            if (count(second)) { const e = differenceError(second); e.message = 'second update is not a no-op: ' + e.message; throw e; }
            for (const other of Object.keys(servers)) {
                if (other === template || !comparable(target, other) || (has80only && other === '8.0') || g.nativeCross === false) continue;
                await expectClean(target, dumps[other]);
            }
        }, { info });
        if (info) continue;
        await check(`re-dump of ${template}->${target} restore matches native ${target}`, async () => {
            const dir = path.join(artifacts, g.name, `redump-${template}-${target}`);
            await dumpTo(target, dir);
            if ((g.nativeCross === false || has80only) && template !== target) return;
            await native(g, target);
            await expectClean(target, dir);
        });
    }
    // 3. drift
    for (const [label, sql, sql2, sqlMode, onlyOn] of g.drift || []) {
        for (const live of Object.keys(servers)) for (const template of Object.keys(servers)) {
            if (onlyOn && live !== onlyOn) continue;
            if (!comparable(live, template) || (has80only && template === '8.0' && live === '5.7')) continue;
            if (g.nativeCross === false && live !== template) continue;
            await check(`drift "${label}" on ${live} vs ${template} dump is detected and repaired`, async () => {
                await native(g, live);
                await runStatement(conns[live], sqlMode ? { sql, sqlMode } : sql);
                if (sql2) await runStatement(conns[live], sql2);
                const diffs = await compare(live, dumps[template]);
                if (!count(diffs)) throw new Error('drift was NOT detected');
                try { await update(live, dumps[template]); } catch (error) { error.message = 'repair failed: ' + error.message; throw error; }
                const after = await compare(live, dumps[template]);
                if (count(after)) { const e = differenceError(after); e.message = 'repair did not converge: ' + e.message; throw e; }
                return { detected: summarize(diffs).map(d => `${d.type}:${d.table}${d.field ? '.' + d.field : ''}${d.index ? '.' + d.index : ''}:${(d.changes || []).join('+')}`) };
            });
        }
    }
}
for (const c of Object.values(conns)) { await resetAll(c); await c.end(); }
await fs.writeFile(path.join(artifacts, 'cross-version-hunt-results.json'), JSON.stringify({ versions: Object.fromEntries(Object.entries(conns).map(([k, c]) => [k, c.version])), results }, null, 2));
const failed = results.filter(r => r.status === 'failed').length;
const infos = results.filter(r => r.status.startsWith('info')).length;
console.log(`${results.length - failed - infos}/${results.length - infos} strict checks passed, ${infos} informational. Evidence: ${path.join(artifacts, 'cross-version-hunt-results.json')}`);
