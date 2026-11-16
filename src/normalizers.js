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
// Only transform SQL code. Strings, quoted identifiers and comments contain
// application data and must not be rewritten as if they were type declarations.
export const transformSQLCode = (sql, transform) => {
    if (typeof sql !== 'string') return sql;
    const protectedText = /'(?:[^'\\]|\\.|'')*'|"(?:[^"\\]|\\.|"")*"|`(?:[^`]|``)*`|\/\*[\s\S]*?\*\/|--[ \t][^\r\n]*(?:\r?\n|$)|#[^\r\n]*(?:\r?\n|$)/g;
    let offset = 0;
    let output = '';
    for (const match of sql.matchAll(protectedText)) {
        output += transform(sql.slice(offset, match.index), match[0]) + match[0];
        offset = match.index + match[0].length;
    }
    return output + transform(sql.slice(offset), null);
};

export const normalizeVersionFormatting = (sql) => transformSQLCode(sql, (code, nextToken) => {
    const types = code
        .replace(/\b(tinyint|smallint|mediumint|int|integer|bigint)\((\d+)\)(\s+unsigned)?(?!\s+(?:unsigned\s+)?zerofill)/gi,
            (match, type, width, unsigned = '') => type.toLowerCase() === 'tinyint' && width === '1' && !unsigned ? match : `${type}${unsigned}`)
        .replace(/\byear\(4\)/gi, 'year');
    // Metadata passes a bare charset/collation name; SQL must name it in a
    // charset clause or literal introducer, not merely as an identifier prefix.
    if (!nextToken && /^\s*utf8mb3(?:_\w+)?\s*$/i.test(types)) return types.replace(/utf8mb3/i, 'utf8');
    return types
        .replace(/(\b(?:CHARACTER\s+SET|CHARSET|COLLATE|USING)\s*=?\s*)utf8mb3(?=\b|_)/gi, '$1utf8')
        .replace(/\b_utf8mb3(\s*)$/gi, (match, spaces) => nextToken?.startsWith("'") ? `_utf8${spaces}` : match);
});

// A column type compared across MySQL versions
export const normalizeColumnType = (type) => normalizeVersionFormatting(type);

export const normalizeSQLDefinition = (definition) => {
    return transformSQLCode(normalizeVersionFormatting(definition), code => code.replace(/\s+/g, ' ')).trim();
}
