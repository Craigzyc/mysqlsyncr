import { parseCreateTableSQL } from '../src/parsers';

// Regression tests for column attributes rendered between the type and the
// NULL/DEFAULT clauses. Before the fix these columns parsed with no Default and
// no NotNull, which produced phantom `mismatched_field` differences whenever the
// two sides of a compare rendered COLLATE differently. The parser also records
// the collation, charset, unsigned and generated expression, so a column can be
// restated without losing them.

const columnOf = (sql, name) =>
    parseCreateTableSQL(sql).columns.find(c => c.Field === name);

describe('Column attributes between type and DEFAULT', () => {

    test('COLLATE does not swallow DEFAULT NULL', () => {
        const input = `CREATE TABLE \`E2Alarms\` (
  \`IID\` varchar(25) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  PRIMARY KEY (\`IID\`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`;

        expect(columnOf(input, 'IID')).toEqual({
            Field: 'IID',
            Type: 'varchar(25)',
            Collate: 'utf8mb4_unicode_ci',
            Default: 'NULL'
        });
    });

    test('a collated column parses the same with or without the COLLATE clause, apart from the collation', () => {
        const withCollate = `CREATE TABLE \`T\` (
  \`point\` varchar(45) COLLATE utf8mb4_unicode_ci DEFAULT NULL
)`;
        const withoutCollate = `CREATE TABLE \`T\` (
  \`point\` varchar(45) DEFAULT NULL
)`;

        const { Collate, ...rest } = columnOf(withCollate, 'point');
        expect(Collate).toBe('utf8mb4_unicode_ci');
        expect(rest).toEqual(columnOf(withoutCollate, 'point'));
    });

    test('CHARACTER SET and COLLATE together do not swallow NOT NULL or DEFAULT', () => {
        const input = `CREATE TABLE \`T\` (
  \`name\` varchar(45) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'x'
)`;

        expect(columnOf(input, 'name')).toEqual({
            Field: 'name',
            Type: 'varchar(45)',
            Charset: 'utf8mb4',
            Collate: 'utf8mb4_unicode_ci',
            NotNull: true,
            Default: 'x'
        });
    });

    test('unsigned does not swallow NOT NULL, DEFAULT or AUTO_INCREMENT, and stays part of the type', () => {
        const input = `CREATE TABLE \`T\` (
  \`qty\` int(11) unsigned NOT NULL DEFAULT '0',
  \`id\` bigint(20) unsigned NOT NULL AUTO_INCREMENT
)`;

        expect(columnOf(input, 'qty')).toEqual({
            Field: 'qty',
            Type: 'int(11) unsigned',
            NotNull: true,
            Default: '0'
        });
        expect(columnOf(input, 'id')).toEqual({
            Field: 'id',
            Type: 'bigint(20) unsigned',
            NotNull: true,
            AutoIncrement: true
        });
    });

    test('a collated column with no DEFAULT still parses without one', () => {
        const input = `CREATE TABLE \`T\` (
  \`alarmString\` text COLLATE utf8mb4_unicode_ci
)`;

        expect(columnOf(input, 'alarmString')).toEqual({
            Field: 'alarmString',
            Type: 'text',
            Collate: 'utf8mb4_unicode_ci'
        });
    });

    test('a collated generated column is not given a DEFAULT', () => {
        const input = `CREATE TABLE \`T\` (
  \`computed_tablename\` varchar(255) COLLATE utf8mb4_unicode_ci GENERATED ALWAYS AS (concat(_utf8mb4'E2Data||',\`IID\`,_utf8mb4'||',\`point\`)) STORED
)`;

        expect(columnOf(input, 'computed_tablename')).toEqual({
            Field: 'computed_tablename',
            Type: 'varchar(255)',
            Collate: 'utf8mb4_unicode_ci',
            Generated: "(concat(_utf8mb4'E2Data||',`IID`,_utf8mb4'||',`point`)) STORED"
        });
    });
});
