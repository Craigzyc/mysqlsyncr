/**
 * Undo formatting that differs between MySQL versions but doesn't change the
 * structure, so a template dumped from one version compares cleanly with
 * another:
 *   - integer display widths: int(11) in 5.7 is int from 8.0.19, except
 *     tinyint(1) and ZEROFILL types, which keep them
 *   - year(4) in 5.7 is year from 8.0.19
 *   - utf8 is shown as utf8mb3 from 8.0.24 (fully from 8.0.30)
 * Applies to column types and to procedure, trigger and view definitions.
 */
export const normalizeVersionFormatting = (sql) => {
    if (typeof sql !== 'string') return sql;
    return sql
        .replace(/\b(tinyint|smallint|mediumint|int|integer|bigint)\((\d+)\)(\s+unsigned)?(?!\s+(?:unsigned\s+)?zerofill)/gi,
            (match, type, width, unsigned = '') => type.toLowerCase() === 'tinyint' && width === '1' && !unsigned ? match : `${type}${unsigned}`)
        .replace(/\byear\(4\)/gi, 'year')
        .replace(/\butf8mb3(?=\b|_)/gi, 'utf8');
}

// A column type compared across MySQL versions
export const normalizeColumnType = (type) => normalizeVersionFormatting(type);

export const normalizeSQLDefinition = (definition) => {
    return normalizeVersionFormatting(definition)
        .replace(/\s+/g, ' ') // Replace multiple whitespace with a single space
        .replace(/'/g, "\\'") // Escape single quotes
        .trim(); // Trim leading and trailing whitespace
}
