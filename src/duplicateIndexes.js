// Detects duplicate and redundant (left-prefix) indexes from information_schema.STATISTICS.
// Read-only: only SELECTs metadata, never drops anything.

const SYSTEM_SCHEMAS = ['mysql', 'sys', 'performance_schema', 'information_schema'];

function quote(name) {
    return '`' + String(name).replace(/`/g, '``') + '`';
}

function groupByTable(rows) {
    const tables = new Map();
    for (const row of rows) {
        const tableKey = JSON.stringify([row.TABLE_SCHEMA, row.TABLE_NAME]);
        if (!tables.has(tableKey)) tables.set(tableKey, { schema: row.TABLE_SCHEMA, table: row.TABLE_NAME, indexes: new Map() });
        const indexes = tables.get(tableKey).indexes;
        if (!indexes.has(row.INDEX_NAME)) {
            indexes.set(row.INDEX_NAME, {
                name: row.INDEX_NAME,
                unique: !Number(row.NON_UNIQUE),
                primary: row.INDEX_NAME === 'PRIMARY',
                type: row.INDEX_TYPE,
                columns: [],
                functional: false,
            });
        }
        const index = indexes.get(row.INDEX_NAME);
        // Functional (expression) indexes have no COLUMN_NAME; they cannot be compared safely.
        if (row.COLUMN_NAME === null || row.COLUMN_NAME === undefined) index.functional = true;
        index.columns.push({ name: row.COLUMN_NAME, prefixLength: row.SUB_PART === null || row.SUB_PART === undefined ? null : Number(row.SUB_PART) });
    }
    return [...tables.values()].map(t => ({ ...t, indexes: [...t.indexes.values()] }));
}

const columnText = column => column.prefixLength ? `${column.name}(${column.prefixLength})` : column.name;
const sameColumn = (a, b) => a.name.toLowerCase() === b.name.toLowerCase() && a.prefixLength === b.prefixLength;

// Is every column of `shorter` a left prefix of `longer`?
function isLeftPrefix(shorter, longer) {
    if (shorter.columns.length > longer.columns.length) return false;
    return shorter.columns.every((column, i) => sameColumn(column, longer.columns[i]));
}

// Rank which index to keep when two are identical: PRIMARY > UNIQUE > plain; then name order.
const keepRank = index => (index.primary ? 0 : index.unique ? 1 : 2);

export function findDuplicateIndexes(rows) {
    const findings = [];
    for (const { schema, table, indexes } of groupByTable(rows)) {
        const comparable = indexes.filter(index => !index.functional);
        const flagged = new Set();
        for (const candidate of comparable) {
            for (const other of comparable) {
                if (other === candidate || flagged.has(other.name)) continue;
                // FULLTEXT/SPATIAL/HASH only compare against indexes of the same type.
                if (candidate.type !== other.type) continue;
                if (!isLeftPrefix(candidate, other)) continue;
                const exact = candidate.columns.length === other.columns.length;
                if (exact) {
                    // Keep the stronger (or alphabetically first) of an identical pair.
                    const keepOther = keepRank(other) < keepRank(candidate)
                        || (keepRank(other) === keepRank(candidate) && other.name < candidate.name);
                    if (!keepOther) continue;
                } else {
                    // A unique/primary prefix enforces a constraint the longer index does not.
                    if (candidate.unique) continue;
                    // FULLTEXT indexes do not serve left-prefix lookups.
                    if (candidate.type === 'FULLTEXT' || candidate.type === 'SPATIAL') continue;
                }
                flagged.add(candidate.name);
                findings.push({
                    database_name: schema,
                    table_name: table,
                    index_name: candidate.name,
                    index_columns: candidate.columns.map(columnText).join(', '),
                    kind: exact ? 'duplicate' : 'redundant',
                    covered_by: other.name,
                    covered_by_columns: other.columns.map(columnText).join(', '),
                    suggested_sql: candidate.primary ? null : `ALTER TABLE ${quote(schema)}.${quote(table)} DROP INDEX ${quote(candidate.name)};`,
                });
                break;
            }
        }
    }
    return findings;
}

export async function collectDuplicateIndexes(connection, database = null) {
    const scope = database ? 'TABLE_SCHEMA = ?' : `TABLE_SCHEMA NOT IN (${SYSTEM_SCHEMAS.map(() => '?').join(', ')})`;
    const params = database ? [database] : SYSTEM_SCHEMAS;
    const [rows] = await connection.query(`SELECT TABLE_SCHEMA, TABLE_NAME, INDEX_NAME, NON_UNIQUE, SEQ_IN_INDEX,
        COLUMN_NAME, SUB_PART, INDEX_TYPE
        FROM information_schema.STATISTICS
        WHERE ${scope}
        ORDER BY TABLE_SCHEMA, TABLE_NAME, INDEX_NAME, SEQ_IN_INDEX`, params);
    return findDuplicateIndexes(rows);
}
