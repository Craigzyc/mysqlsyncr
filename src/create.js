export const generateCreateTableSQL = (tableName, fields) => {
    const columns = fields
        .map(col => {
            const nullClause = col.Null === 'NO' ? 'NOT NULL' : 'NULL';
            const defaultClause = col.Default === 'CURRENT_TIMESTAMP' ? 'DEFAULT CURRENT_TIMESTAMP' : (col.Default !== null ? `DEFAULT '${col.Default}'` : '');
            const extraClause = col.Extra || '';
            return `\`${col.Field}\` ${col.Type} ${nullClause} ${defaultClause} ${extraClause}`.trim();
        })
        .join(', ');

    const primaryKey = fields.find(field => field.Key === 'PRI');
    const primaryKeyClause = primaryKey ? `, PRIMARY KEY (\`${primaryKey.Field}\`)` : '';

    return `CREATE TABLE \`${tableName}\` (${columns}${primaryKeyClause});`;
}