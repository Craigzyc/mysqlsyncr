const primaryKeyColumns = (table) => table?.indexes
    ?.find(i => i.Primary || i.Name === 'PRIMARY')
    ?.ColumnName.map(col => col.replace(/\(\d+\)$/, ''));

/**
 * Seed rows from the sync options that aren't in the database yet, as
 * missing_row differences. A row counts as present when a row with the same
 * rowKey values exists, whatever its other columns hold. Rows for a table that
 * doesn't exist yet are all missing; they're applied after the table is created.
 */
export const findMissingRows = async (connection, database, expected, current, syncOptions) => {
    const differences = [];
    for (const [tableName, tableOptions] of Object.entries(syncOptions?.databases?.[database] || {})) {
        if (!tableOptions?.rows?.length) continue;

        const key = tableOptions.rowKey ?? primaryKeyColumns(expected.tables?.[tableName]) ?? primaryKeyColumns(current.tables?.[tableName]);
        if (!key) {
            throw new Error(`${database}.${tableName}: rows need a rowKey because the table has no primary key`);
        }
        const tableExists = !!current.tables?.[tableName];

        for (const row of tableOptions.rows) {
            const missingKeyColumns = key.filter(col => !(col in row));
            if (missingKeyColumns.length > 0) {
                throw new Error(`${database}.${tableName}: a row is missing rowKey column(s) ${missingKeyColumns.join(', ')}: ${JSON.stringify(row)}`);
            }
            const rowKey = Object.fromEntries(key.map(col => [col, row[col]]));

            if (tableExists) {
                const where = key.map(col => row[col] === null ? `\`${col}\` IS NULL` : `\`${col}\` = ?`).join(' AND ');
                const values = key.filter(col => row[col] !== null).map(col => row[col]);
                let found;
                try {
                    found = await connection.query(`SELECT 1 FROM \`${database}\`.\`${tableName}\` WHERE ${where} LIMIT 1`, values);
                } catch (err) {
                    // e.g. a key column the table doesn't have yet; checked again once the structure is fixed
                    console.error(`Could not check seed rows for ${database}.${tableName}: ${err.message}`);
                    break;
                }
                if (found.length > 0) continue;
            }
            differences.push({ type: 'missing_row', tableName, key: rowKey, row });
        }
    }
    return differences;
}
