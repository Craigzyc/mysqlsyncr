import { findDuplicateIndexes, collectDuplicateIndexes } from '../src/duplicateIndexes';

const idx = (table, name, cols, { unique = false, type = 'BTREE', schema = 'app' } = {}) =>
    cols.map((col, i) => {
        const [column, sub] = Array.isArray(col) ? col : [col, null];
        return { TABLE_SCHEMA: schema, TABLE_NAME: table, INDEX_NAME: name, NON_UNIQUE: unique ? 0 : 1, SEQ_IN_INDEX: i + 1, COLUMN_NAME: column, SUB_PART: sub, INDEX_TYPE: type };
    });

test('flags exact duplicates and keeps the stronger index', () => {
    const found = findDuplicateIndexes([...idx('t', 'PRIMARY', ['id'], { unique: true }), ...idx('t', 'id_idx', ['id'])]);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ index_name: 'id_idx', kind: 'duplicate', covered_by: 'PRIMARY' });
    expect(found[0].suggested_sql).toBe('ALTER TABLE `app`.`t` DROP INDEX `id_idx`;');
});

test('flags only one of two identical plain indexes', () => {
    const found = findDuplicateIndexes([...idx('t', 'a1', ['a', 'b']), ...idx('t', 'a2', ['a', 'b'])]);
    expect(found.map(f => f.index_name)).toEqual(['a2']);
});

test('flags left-prefix redundant indexes but not unique prefixes', () => {
    const found = findDuplicateIndexes([
        ...idx('t', 'a', ['a']), ...idx('t', 'u_a', ['a'], { unique: true }), ...idx('t', 'ab', ['a', 'b']), ...idx('t', 'b', ['b']),
    ]);
    expect(found).toEqual([expect.objectContaining({ index_name: 'a', covered_by: 'u_a', kind: 'duplicate' })]);
    const noUnique = findDuplicateIndexes([...idx('t', 'a', ['a']), ...idx('t', 'ab', ['a', 'b'])]);
    expect(noUnique).toEqual([expect.objectContaining({ index_name: 'a', kind: 'redundant', covered_by: 'ab' })]);
});

test('respects prefix lengths, index types, tables, and functional indexes', () => {
    expect(findDuplicateIndexes([...idx('t', 'p10', [['name', 10]]), ...idx('t', 'p20', [['name', 20]])])).toEqual([]);
    expect(findDuplicateIndexes([...idx('t', 'ft', ['body'], { type: 'FULLTEXT' }), ...idx('t', 'bt', ['body'])])).toEqual([]);
    expect(findDuplicateIndexes([...idx('t1', 'a', ['a']), ...idx('t2', 'a', ['a'])])).toEqual([]);
    expect(findDuplicateIndexes([...idx('t', 'f1', [null]), ...idx('t', 'f2', [null])])).toEqual([]);
});

test('queries STATISTICS with a bound schema', async () => {
    const connection = { query: jest.fn().mockResolvedValue([[]]) };
    await collectDuplicateIndexes(connection, "app' OR 1=1");
    const [sql, params] = connection.query.mock.calls[0];
    expect(sql).toContain('information_schema.STATISTICS');
    expect(sql).not.toContain("app' OR 1=1");
    expect(params).toEqual(["app' OR 1=1"]);
});

test('does not treat mixed descending key parts as duplicate indexes', () => {
    const ascending = idx('t', 'ascending', ['a', 'b']).map(row => ({ ...row, COLLATION: 'A' }));
    const mixed = idx('t', 'mixed', ['a', 'b']).map((row, i) => ({ ...row, COLLATION: i ? 'D' : 'A' }));
    expect(findDuplicateIndexes([...ascending, ...mixed])).toEqual([]);
});

test('never recommends replacing a visible index with an invisible one', () => {
    const invisible = idx('t', 'a_invisible', ['a']).map(row => ({ ...row, IS_VISIBLE: 'NO' }));
    const visible = idx('t', 'z_visible', ['a']).map(row => ({ ...row, IS_VISIBLE: 'YES' }));
    const result = findDuplicateIndexes([...invisible, ...visible]);
    expect(result).toEqual([expect.objectContaining({ index_name: 'a_invisible', covered_by: 'z_visible' })]);
});

test('only BTREE indexes support a left-prefix replacement', () => {
    expect(findDuplicateIndexes([...idx('t', 'a', ['a'], { type: 'HASH' }), ...idx('t', 'ab', ['a', 'b'], { type: 'HASH' })])).toEqual([]);
});

test('preserves a unique invisible index instead of replacing it with a visible nonunique one', () => {
    const invisible = idx('t', 'u', ['a'], { unique: true }).map(row => ({ ...row, IS_VISIBLE: 'NO' }));
    const visible = idx('t', 'a', ['a']).map(row => ({ ...row, IS_VISIBLE: 'YES' }));
    expect(findDuplicateIndexes([...invisible, ...visible])).toEqual([]);
});

test('reads MySQL 8 visibility and falls back for the absent 5.7 metadata column', async () => {
    const connection = { query: jest.fn()
        .mockRejectedValueOnce(Object.assign(new Error('Unknown IS_VISIBLE'), { code: 'ER_BAD_FIELD_ERROR' }))
        .mockResolvedValueOnce([[]]) };
    await collectDuplicateIndexes(connection, 'app');
    expect(connection.query.mock.calls[0][0]).toContain('IS_VISIBLE');
    expect(connection.query.mock.calls[1][0]).not.toContain('IS_VISIBLE');
    expect(connection.query.mock.calls[1][0]).toContain('COLLATION');
});
