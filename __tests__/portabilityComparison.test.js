import { findDifferences } from '../src/differences';
import { parseCreateTableSQL } from '../src/parsers';
import { getDefaultCollations, portableCollation, versionNotes } from '../src/versions';
import { normalizeSQLDefinition } from '../src/normalizers';

const shape = sql => ({ tables: { t: { ...parseCreateTableSQL(sql), createSQL: sql, triggers: [] } }, procedures: [] });
const implicit = 'CREATE TABLE `t` (\n `label` varchar(20) DEFAULT NULL\n) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4';

describe('server-dependent defaults and explicit collation intent', () => {
    test.each(['utf8mb4_0900_ai_ci', 'utf8mb4_general_ci'])('uses the actual server default %s', collation => {
        expect(findDifferences(shape(implicit), shape(implicit + ' COLLATE=' + collation), undefined, {
            serverVersion: '8.0.44', defaultCollations: { utf8mb4: collation }
        })).toEqual([]);
    });
    test('unavailable default metadata does not invent a collation mismatch', () => {
        expect(findDifferences(shape(implicit), shape(implicit + ' COLLATE=utf8mb4_0900_ai_ci'), undefined, { serverVersion: '8.0.44' })).toEqual([]);
    });
    test('an explicit template collation remains authoritative', () => {
        const diffs = findDifferences(shape(implicit + ' COLLATE=utf8mb4_unicode_ci'), shape(implicit + ' COLLATE=utf8mb4_0900_ai_ci'), undefined, {
            serverVersion: '8.0.44', defaultCollations: { utf8mb4: 'utf8mb4_0900_ai_ci' }
        });
        expect(diffs.map(diff => diff.type)).toEqual(['mismatched_table_options', 'mismatched_field']);
        expect(diffs[1].field.Collate).toBe('utf8mb4_unicode_ci');
    });
    test('a column with its own charset uses that charset default instead of the table collation', () => {
        const expected = implicit.replace('varchar(20)', 'varchar(20) CHARACTER SET latin1') + ' COLLATE=utf8mb4_unicode_ci';
        const current = expected.replace('CHARACTER SET latin1 DEFAULT', 'CHARACTER SET latin1 COLLATE latin1_swedish_ci DEFAULT');
        expect(findDifferences(shape(expected), shape(current), undefined, { defaultCollations: { latin1: 'latin1_swedish_ci' } })).toEqual([]);
    });
    test('reads server defaults and overlays the utf8mb4 session override', async () => {
        const query = jest.fn(async sql => sql.startsWith('SHOW')
            ? [{ Charset: 'utf8mb4', 'Default collation': 'utf8mb4_0900_ai_ci' }, { Charset: 'latin1', 'Default collation': 'latin1_swedish_ci' }]
            : [{ collation: 'utf8mb4_general_ci' }]);
        expect(await getDefaultCollations({ query }, '8.0.44')).toEqual({ utf8mb4: 'utf8mb4_general_ci', latin1: 'latin1_swedish_ci' });
    });
    test('missing metadata permissions leave unspecified defaults unknown', async () => {
        expect(await getDefaultCollations({ query: async () => { throw new Error('permission denied'); } }, '8.0.44')).toEqual({});
    });
    test('transport failure is not converted into a clean default snapshot', async () => {
        const error = Object.assign(new Error('connection lost'), { fatal: true });
        await expect(getDefaultCollations({ query: async () => { throw error; } }, '8.0.44')).rejects.toThrow('connection lost');
    });
});

describe('documented 5.7 compatibility reductions', () => {
    test('an 8.0 invisible index compares as visible on 5.7 only', () => {
        const expected = implicit.replace('DEFAULT NULL\n', 'DEFAULT NULL,\n KEY `lookup` (`label`) INVISIBLE\n');
        const current = expected.replace(' INVISIBLE', '');
        expect(findDifferences(shape(expected), shape(current), undefined, { serverVersion: '5.7.44' })).toEqual([]);
        expect(findDifferences(shape(expected), shape(current), undefined, { serverVersion: '8.0.44' })).toEqual([
            expect.objectContaining({ type: 'mismatched_index', index: expect.objectContaining({ Visible: false }) })
        ]);
    });
    test('version notes disclose both visibility reduction and collation approximation', () => {
        const notes = versionNotes('8.0.44', '5.7.44').join(' ');
        expect(notes).toMatch(/index visibility/i);
        expect(notes).toMatch(/approximate|approximation/i);
        expect(notes).toMatch(/accent/i);
        expect(portableCollation('utf8mb4_0900_as_ci')).toBe('utf8mb4_unicode_ci');
    });
    test('utf8 literal introducers normalize outside the protected string', () => {
        const first = "CREATE PROCEDURE `p`(IN n int(11)) BEGIN SELECT _utf8'hello', 'a  b'; END";
        const second = "CREATE PROCEDURE `p`(IN n int) BEGIN SELECT _utf8mb3'hello', 'a  b'; END";
        expect(normalizeSQLDefinition(first)).toBe(normalizeSQLDefinition(second));
        expect(normalizeSQLDefinition("SELECT '_utf8mb3'")).not.toBe(normalizeSQLDefinition("SELECT '_utf8'"));
    });
    test('charset-looking unquoted column names remain distinct identifiers', () => {
        expect(normalizeSQLDefinition('SELECT utf8mb3_value, _utf8mb3 FROM t')).not.toBe(normalizeSQLDefinition('SELECT utf8_value, _utf8 FROM t'));
    });
});
