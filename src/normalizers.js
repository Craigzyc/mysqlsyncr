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

// A column type compared across MySQL versions. 8.0 prints geometrycollection
// as geomcollection.
export const normalizeColumnType = (type) => normalizeVersionFormatting(type)?.replace(/^geometrycollection\b/i, 'geomcollection');

// Procedure and trigger bodies are stored as written: compare them as SQL.
export const normalizeSQLDefinition = (definition) => {
    return transformSQLCode(normalizeVersionFormatting(definition), code => code.replace(/\s+/g, ' ')).trim();
}

// 8.0 rewrites generated-column expressions, expression defaults and views and
// stores the session charset as an introducer on their string literals
// (concat(_utf8mb4'p-',`qty`)), where 5.7 stores the literal as written. Only
// for that server-rewritten SQL, drop the introducer when comparing. Only real
// charset names count (a column named _x before a string alias is not one), and
// _binary stays: it makes the literal a binary string, which changes results.
const CHARSETS = 'armscii8|ascii|big5|cp1250|cp1251|cp1256|cp1257|cp850|cp852|cp866|cp932|dec8|eucjpms|euckr|gb18030|gb2312|gbk|geostd8|greek|hebrew|hp8|keybcs2|koi8r|koi8u|latin1|latin2|latin5|latin7|macce|macroman|sjis|swe7|tis620|ucs2|ujis|utf16le|utf16|utf32|utf8mb3|utf8mb4|utf8';
const introducer = new RegExp(`(^|[^\\w$\`])_(?:${CHARSETS})\\s*$`, 'i');

// 8.0 prints the boolean literals TRUE/FALSE as true/false where 5.7 stores 1/0.
// They differ against JSON values in 8.0, so only treat them as equal when asked
// to (comparing a template and a server of different major versions).
export const normalizeServerExpression = (definition, { booleans = false } = {}) => {
    return transformSQLCode(normalizeVersionFormatting(definition), (code, nextToken) => {
        let result = nextToken?.startsWith("'") ? code.replace(introducer, '$1') : code;
        if (booleans) result = result.replace(/(^|[^\w$.@])(true|false)(?![\w$(])/gi, (match, before, word) => before + (word.toLowerCase() === 'true' ? '1' : '0'));
        return result.replace(/\s+/g, ' ');
    }).trim();
}

// The select list of `rest` (the text after SELECT): where each top-level item
// ends, and where the list can end (a top-level FROM or UNION, or the end).
// Quotes, names and comments are skipped, so `,`, `(` or `from` inside a string
// don't count.
const selectListShape = (rest) => {
    const commas = [];
    const ends = [];
    let depth = 0;
    let offset = 0;
    transformSQLCode(rest, (code, token) => {
        for (let i = 0; i < code.length; i++) {
            if (code[i] === '(') depth++;
            else if (code[i] === ')') depth--;
            else if (depth === 0 && code[i] === ',') commas.push(offset + i);
            else if (depth === 0 && /\s/.test(code[i]) && /^\s(?:from|union)\b/i.test(code.slice(i))) ends.push(offset + i);
        }
        offset += code.length + (token?.length || 0);
        return code;
    });
    ends.push(rest.length);
    return { commas, ends };
};

/**
 * A view as SHOW CREATE VIEW prints it. Given an explicit column list,
 * CREATE VIEW v (c1, c2) AS SELECT id, name ..., 8.0 keeps the list and the
 * select's own aliases, while 5.7 drops the list and aliases the select
 * columns as c1, c2. Rewrite the 8.0 form into the 5.7 form, then compare as
 * server-rewritten SQL. Anything that doesn't parse is compared as printed.
 */
export const normalizeViewDefinition = (definition, options = {}) => {
    if (typeof definition !== 'string') return definition;
    const header = definition.match(/^([\s\S]*?\bVIEW\s+(?:`(?:[^`]|``)+`\s*\.\s*)?`(?:[^`]|``)+`\s*)\(((?:\s*`(?:[^`]|``)+`\s*,?)+)\)(\s*AS\s+select\s+)([\s\S]*)$/i);
    if (!header) return normalizeServerExpression(definition, options);
    const [, head, list, as, rest] = header;
    const names = [...list.matchAll(/`((?:[^`]|``)+)`/g)].map(m => m[0]);
    const { commas, ends } = selectListShape(rest);
    // The first end with exactly one item per listed column.
    const end = ends.find(position => commas.filter(comma => comma < position).length === names.length - 1);
    if (end === undefined) return normalizeServerExpression(definition, options);
    const bounds = [-1, ...commas.filter(comma => comma < end), end];
    const items = names.map((name, i) => {
        const item = rest.slice(bounds[i] + 1, bounds[i + 1]);
        const aliased = item.match(/^([\s\S]*?)\s+AS\s+`(?:[^`]|``)+`\s*$/i);
        return `${aliased ? aliased[1] : item.trim()} AS ${name}`;
    });
    return normalizeServerExpression(`${head.trimEnd()} ${as.trim()} ${items.join(',')}${rest.slice(end)}`, options);
};

// 8.0 SHOW CREATE TRIGGER quotes the trigger and table names in the header
// (TRIGGER `t` BEFORE INSERT ON `tbl`); 5.7 returns the header as written.
// Compare a canonical header plus the normalized body.
const identifier = '(?:`(?:[^`]|``)+`|[\\w$\\u0080-\\uffff]+)';
const account = "(?:`(?:[^`]|``)*`|'(?:[^']|'')*'|[^\\s@`']+)";
const definerClause = `(CURRENT_USER(?:\\s*\\(\\s*\\))?|${account}(?:\\s*@\\s*${account})?)`;
const triggerHeader = new RegExp(`^CREATE\\s+(?:DEFINER\\s*=\\s*${definerClause}\\s+)?TRIGGER\\s+(?:${identifier}\\s*\\.\\s*)?(${identifier})\\s+(BEFORE|AFTER)\\s+(INSERT|UPDATE|DELETE)\\s+ON\\s+(?:${identifier}\\s*\\.\\s*)?(${identifier})\\s+FOR\\s+EACH\\s+ROW\\s+(?:(FOLLOWS|PRECEDES)\\s+(${identifier})\\s+)?`, 'i');
const unquoteIdentifier = name => name.startsWith('`') ? name.slice(1, -1).replace(/``/g, '`') : name;
// User names are case-sensitive; only the quoting style is formatting.
const canonicalDefiner = definer => definer.replace(/\s*@\s*/, '@').replace(/[`']/g, '');

export const normalizeTriggerDefinition = (definition) => {
    if (typeof definition !== 'string') return definition;
    const trimmed = definition.trim();
    const header = trimmed.match(triggerHeader);
    if (!header) return normalizeSQLDefinition(trimmed);
    const [whole, definer, name, timing, event, table, order, other] = header;
    return JSON.stringify([
        definer ? canonicalDefiner(definer) : null,
        unquoteIdentifier(name), timing.toUpperCase(), event.toUpperCase(), unquoteIdentifier(table),
        order ? `${order.toUpperCase()} ${unquoteIdentifier(other)}` : null,
        normalizeSQLDefinition(trimmed.slice(whole.length)),
    ]);
}
