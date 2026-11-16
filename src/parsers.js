// Split at the table body's top-level commas, preserving commas/parentheses in
// expressions, enum values and comments. SHOW CREATE is multiline, but templates
// may also contain compact CREATE statements.
export const splitCreateTableSQL = (sql) => {
    const open = sql.indexOf('(');
    if (open < 0) throw new Error('CREATE TABLE has no column definitions');
    const definitions = [];
    let depth = 1;
    let start = open + 1;
    let quote = null;
    for (let i = start; i < sql.length; i++) {
        const char = sql[i];
        if (quote) {
            if (char === '\\' && quote !== '`') i++;
            else if (char === quote && sql[i + 1] === quote) i++;
            else if (char === quote) quote = null;
            continue;
        }
        if (char === "'" || char === '"' || char === '`') { quote = char; continue; }
        if (char === '(') depth++;
        if (char === ')') {
            depth--;
            if (depth === 0) {
                if (sql.slice(start, i).trim()) definitions.push(sql.slice(start, i).trim());
                return { head: sql.slice(0, open + 1), definitions, tail: sql.slice(i) };
            }
        }
        if (char === ',' && depth === 1) { definitions.push(sql.slice(start, i).trim()); start = i + 1; }
    }
    throw new Error('CREATE TABLE has unclosed column definitions');
};

export const splitTableForeignKeys = (sql) => {
    const parts = splitCreateTableSQL(sql);
    const constraints = parts.definitions.map(parseConstraint).filter(Boolean);
    if (!constraints.length) return { createSQL: sql, constraints };
    const definitions = parts.definitions.filter(definition => !parseConstraint(definition));
    return { createSQL: `${parts.head}\n  ${definitions.join(',\n  ')}\n${parts.tail}`, constraints };
};

export const parseCreateTableSQL = (createTableSQL) => {
    if(!createTableSQL) return null;
    const nameMatch = createTableSQL.match(/CREATE TABLE\s+(?:IF NOT EXISTS\s+)?`((?:``|[^`])+)`/i);
    if (!nameMatch) throw new Error('Expected CREATE TABLE with a quoted table name');
    const name = nameMatch[1].replace(/``/g, '`');
    const columns = [];
    const indexes = [];
    const constraints = [];
    let engine = null;
    let charset = null;
    let collate = null;

    // Split the SQL statement into lines and filter out empty lines
    const parts = splitCreateTableSQL(createTableSQL);
    const lines = parts.definitions;

    // Process each line
    for (const line of lines) {
        if (line.includes('CREATE TABLE')) {
            continue;
        }
        // Column definitions are the only lines that start with a backticked name
        const column = parseColumnDefinition(line);
        const indexMatch = line.match(/^(?:(PRIMARY|UNIQUE|FULLTEXT|SPATIAL)\s+)?(?:KEY|INDEX)\s*(?:`([^`]+)`\s*)?(?:USING\s+(BTREE|HASH)\s*)?\(/i);

        const constraintMatch = parseConstraint(line);
        if (column) {
            columns.push(column);
        } else if (indexMatch && !constraintMatch) {

            const isPrimary = indexMatch[1]?.toUpperCase() === 'PRIMARY';
            const isUnique = indexMatch[1]?.toUpperCase() === 'UNIQUE';
            const indexParts = splitCreateTableSQL(line);
            const columnNames = indexParts.definitions.map(column => column.startsWith('(')
                ? column : column.replace(/`/g, '').replace(/\s+ASC$/i, '').replace(/\s+DESC$/i, ' DESC'));
            const index = { ColumnName: columnNames, Name: isPrimary ? 'PRIMARY' : indexMatch[2] };
            if (isPrimary) index.Primary = true;
            if (isUnique) index.Unique = true;
            const kind = indexMatch[1]?.toUpperCase();
            const algorithm = indexMatch[3]?.toUpperCase() || indexParts.tail.match(/\bUSING\s+(BTREE|HASH)/i)?.[1].toUpperCase();
            if (kind === 'FULLTEXT' || kind === 'SPATIAL') index.Type = kind;
            else if (algorithm && algorithm !== 'BTREE') index.Type = algorithm;
            if (/\bINVISIBLE\b/i.test(indexParts.tail)) index.Visible = false;
            indexes.push(index);

        } else if (constraintMatch) {
            constraints.push(constraintMatch);
        }

    }

    // Handle table options
    engine = parts.tail.match(/\bENGINE\s*=\s*(\w+)/i)?.[1] ?? null;
    charset = parts.tail.match(/\b(?:DEFAULT\s+)?CHARSET\s*=\s*(\w+)/i)?.[1] ?? null;
    collate = parts.tail.match(/\bCOLLATE\s*=\s*(\w+)/i)?.[1] ?? null;
    return { name, columns, indexes, constraints, engine, charset, collate };
}

export const parseConstraint = (sql) => {
    if(!sql) return null;
    const regex = /^\s*CONSTRAINT\s+`((?:``|[^`])+)`\s+FOREIGN KEY\s*\(([^)]+)\)\s+REFERENCES\s+(?:`((?:``|[^`])+)`\s*\.\s*)?`((?:``|[^`])+)`\s*\(([^)]+)\)/i;
    const match = sql.match(regex);
    if (!match) return null;
    const identifiers = text => [...text.matchAll(/`((?:``|[^`])+)`/g)].map(m => m[1].replace(/``/g, '`'));
    const columns = identifiers(match[2]);
    const referenced = identifiers(match[5]);
    const references = { Table: match[4].replace(/``/g, '`'), Column: referenced.length === 1 ? referenced[0] : referenced };
    if (referenced.length > 1) references.Columns = referenced;
    if (match[3]) references.Database = match[3].replace(/``/g, '`');
    return {
        Name: match[1].replace(/``/g, '`'),
        Type: "FOREIGN KEY",
        ColumnName: columns,
        References: references,
        OnDelete: sql.match(/\bON DELETE\s+(NO ACTION|RESTRICT|CASCADE|SET NULL|SET DEFAULT)/i)?.[1].toUpperCase() ?? 'NO ACTION',
        OnUpdate: sql.match(/\bON UPDATE\s+(NO ACTION|RESTRICT|CASCADE|SET NULL|SET DEFAULT)/i)?.[1].toUpperCase() ?? 'NO ACTION',
    };
};

// A quoted SQL string, allowing '' and backslash escapes inside it
const quotedStringRegex = /'(?:[^'\\]|\\.|'')*'/g;

const unquote = quoted => quoted.slice(1, -1).replace(/''/g, "'").replace(/\\([\s\S])/g, (_match, char) => ({
    '0': '\0', b: '\b', n: '\n', r: '\r', t: '\t', Z: '\x1a', '%': '\\%', '_': '\\_'
}[char] ?? char));

// Type with its parameters: int, float(10,2), enum('a','b'), varchar(45); then unsigned/zerofill
const columnTypeRegex = /^([a-zA-Z]+(?:\((?:'(?:[^'\\]|\\.|'')*'|[^)'])*\))?)((?:\s+(?:unsigned|zerofill)\b)*)/i;

/**
 * Parse one column line of a SHOW CREATE TABLE statement, e.g.
 *   `IID` varchar(25) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT 'x',
 * Returns null if the line isn't a column definition.
 */
export const parseColumnDefinition = (line) => {
    const lineMatch = line.trim().match(/^`([^`]+)`\s+(.*?),?$/);
    if (!lineMatch) return null;
    const typeMatch = lineMatch[2].match(columnTypeRegex);
    if (!typeMatch) return null;

    const column = {
        Field: lineMatch[1],
        // unsigned/zerofill are part of the type: a column restated without them changes
        Type: typeMatch[1] + typeMatch[2].toLowerCase()
    };

    // Swap quoted strings for numbered placeholders so keywords inside a
    // COMMENT or DEFAULT value aren't matched as attributes
    const strings = [];
    const quoted = [];
    const rest = lineMatch[2].slice(typeMatch[0].length).replace(quotedStringRegex, (text) => {
        strings.push(unquote(text));
        quoted.push(text);
        return `'${strings.length - 1}'`;
    });
    // Put the original quoted text back, e.g. b'0' or (_utf8mb4'[]')
    const restoreQuoted = (text) => text.replace(/'(\d+)'/g, (_, i) => quoted[i]);

    if (/\bNOT NULL\b/i.test(rest)) {
        column.NotNull = true;
    }

    const parenthesized = text => {
        if (!text.startsWith('(')) return null;
        let depth = 0;
        for (let i = 0; i < text.length; i++) {
            if (text[i] === '(') depth++;
            else if (text[i] === ')' && --depth === 0) return text.slice(0, i + 1);
        }
        return null;
    };
    const defaultStart = rest.match(/\bDEFAULT\s+/i);
    const defaultText = defaultStart ? rest.slice(defaultStart.index + defaultStart[0].length) : '';
    const defaultValue = parenthesized(defaultText) || defaultText.match(/^('\d+'|[^\s,]+)/)?.[1];
    const defaultMatch = defaultValue ? [null, defaultValue] : null;
    if (defaultMatch) {
        // A plain string default is stored unquoted; anything else (NULL,
        // CURRENT_TIMESTAMP, b'0', an expression) is kept as written
        const whole = defaultMatch[1].match(/^'(\d+)'$/);
        column.Default = whole ? strings[whole[1]] : restoreQuoted(defaultMatch[1]);
        // Preserve the distinction between SQL NULL/functions/expressions and a
        // quoted string whose contents happen to look like SQL.
        if (whole && /^(?:NULL$|CURRENT_TIMESTAMP(?:\(\d*\))?$|now(?:\(\d*\))?$|\(|[bx]'|0x)/i.test(column.Default)) column.DefaultQuoted = true;
    }

    const generatedStart = rest.match(/\bGENERATED ALWAYS AS\s*/i);
    if (generatedStart) {
        const text = rest.slice(generatedStart.index + generatedStart[0].length);
        const expression = parenthesized(text);
        if (!expression) throw new Error(`Invalid generated expression for ${column.Field}`);
        const storage = text.slice(expression.length).match(/^\s*(STORED|VIRTUAL)\b/i)?.[1];
        column.Generated = `${restoreQuoted(expression)}${storage ? ` ${storage.toUpperCase()}` : ''}`;
    }

    if (/\bAUTO_INCREMENT\b/i.test(rest)) {
        column.AutoIncrement = true;
    }

    const onUpdateMatch = rest.match(/\bON UPDATE\s+(CURRENT_TIMESTAMP(?:\(\d*\))?)/i);
    if (onUpdateMatch) {
        column.OnUpdate = onUpdateMatch[1];
    }

    const charsetMatch = rest.match(/\bCHARACTER SET\s+(\w+)/i);
    if (charsetMatch) {
        column.Charset = charsetMatch[1];
    }

    const collateMatch = rest.match(/\bCOLLATE\s+(\w+)/i);
    if (collateMatch) {
        column.Collate = collateMatch[1];
    }

    const commentMatch = rest.match(/\bCOMMENT\s+'(\d+)'/i);
    if (commentMatch) {
        column.Comment = strings[commentMatch[1]];
    }

    return column;
};
