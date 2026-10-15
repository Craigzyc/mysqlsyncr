export const parseCreateTableSQL = (createTableSQL) => {
    if(!createTableSQL) return null;
    const name = createTableSQL.match(/CREATE TABLE\s+`([^`]+)`/)[1];
    const columns = [];
    const indexes = [];
    const constraints = [];
    let engine = null;
    let charset = null;
    let collate = null;

    // Split the SQL statement into lines and filter out empty lines
    const lines = createTableSQL.split('\n').map(line => line.trim()).filter(line => line.length > 0);

    // Regular expression to match index definitions
    const indexRegex_Old = /(PRIMARY|UNIQUE)?\s*KEY\s*`([^`]+)`\s*\(([^)]+)\)|PRIMARY KEY\s*\(([^)]+)\)/;

    // Updated to support indexes for text fields 
    // 'KEY `idx_e2alarms_alarmstring` (`alarmString`(255))' -- would cut off the final bracket and wouldnt work.
    const indexRegex = /(PRIMARY|UNIQUE)?\s*KEY\s*`([^`]+)`\s*\(((?:`[^`]+`(?:\(\d+\))?(?:\s*,\s*)?)+)\)|PRIMARY KEY\s*\(((?:`[^`]+`(?:\(\d+\))?(?:\s*,\s*)?)+)\)/;

    // Regular expression to match table options (ENGINE, CHARSET, COLLATE)
    const optionsRegex = /ENGINE=(\w+)\s+DEFAULT\s+CHARSET=(\w+)(\s+COLLATE=(\w+))?/;


    // Process each line
    for (const line of lines) {
        if (line.includes('CREATE TABLE')) {
            continue;
        }
        // Column definitions are the only lines that start with a backticked name
        const column = parseColumnDefinition(line);
        const indexMatch = indexRegex.exec(line);

        const constraintMatch = parseConstraint(line);
        if (column) {
            columns.push(column);
        } else if (indexMatch && !constraintMatch) {

            const isPrimary = line.includes("PRIMARY KEY"); // Check for PRIMARY in both patterns
            const isUnique = line.includes("UNIQUE KEY"); // Only set Unique if it matches

            const keyName = isPrimary ? null : indexMatch[2]; // Set KeyName to null if it's a primary key
            const columnNames = indexMatch[3] 
            ? indexMatch[3].split(',').map(col => col.trim().replace(/`/g, '')) // Remove backticks
            : indexMatch[4].split(',').map(col => col.trim().replace(/`/g, '')); // Remove backticks
            const index = {
                ColumnName: columnNames
            };
            if (isPrimary) index.Primary = true, index.Name = "PRIMARY"
            if (isUnique) index.Unique = true;
            if (keyName) index.Name = keyName;
            indexes.push(index);

        } else if (constraintMatch) {
            constraints.push(constraintMatch);
        }

    }

    // Handle table options
    const optionsMatch = optionsRegex.exec(createTableSQL);
    if (optionsMatch) {
        engine = optionsMatch[1];
        charset = optionsMatch[2];
        collate = optionsMatch[4] || null; // Collate may not be present
    }
    return { name, columns, indexes, constraints, engine, charset, collate };
}

export const parseConstraint = (sql) => {
    if(!sql) return null;
    const regex = /FOREIGN KEY \((`[^`]+`)\) REFERENCES (`[^`]+`)\s?\((`[^`]+`)\)(?:\sON DELETE (NO|CASCADE|SET NULL|SET DEFAULT))?(?:\sON UPDATE (NO ACTION|CASCADE|SET NULL|SET DEFAULT))?/i;
    const match = sql.match(regex);

    if (!match) {
        return null;
    }
    let onDelete = null;    
    let onUpdate = null;
    if(sql.includes('ON DELETE CASCADE')){
        onDelete = 'CASCADE';
    }else if(sql.includes('ON DELETE SET NULL')){
        onDelete = 'SET NULL';
    }else if(sql.includes('ON DELETE SET DEFAULT')){
        onDelete = 'SET DEFAULT';
    }else{
        onDelete = 'NO ACTION';
    }

    if(sql.includes('ON UPDATE CASCADE')){
        onUpdate = 'CASCADE';
    }else if(sql.includes('ON UPDATE SET NULL')){
        onUpdate = 'SET NULL';
    }else if(sql.includes('ON UPDATE SET DEFAULT')){
        onUpdate = 'SET DEFAULT';
    }else{
        onUpdate = 'NO ACTION';
    }
    let columnName = match[1] || ''
    columnName = columnName.replace(/`/g, '')
    let table = match[2] || ''
    table = table.replace(/`/g, '')
    let column = match[3] || ''
    column = column.replace(/`/g, '')
    return {
        Name: "AlertRule", // Replace with actual constraint name if needed
        Type: "FOREIGN KEY",
        ColumnName: [columnName], // Column in the current table
        References: {
            Table: table, // Referenced table
            Column: column, // Referenced column
        },
        OnDelete: onDelete, 
        OnUpdate: onUpdate, 
    };
};

// A quoted SQL string, allowing '' and backslash escapes inside it
const quotedStringRegex = /'(?:[^'\\]|\\.|'')*'/g;

const unquote = (quoted) => quoted.slice(1, -1).replace(/''/g, "'").replace(/\\(.)/g, '$1');

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

    const defaultMatch = rest.match(/\bDEFAULT\s+('\d+'|\((?:[^()]|\([^()]*\))*\)|[^\s,]+)/i);
    if (defaultMatch) {
        // A plain string default is stored unquoted; anything else (NULL,
        // CURRENT_TIMESTAMP, b'0', an expression) is kept as written
        const whole = defaultMatch[1].match(/^'(\d+)'$/);
        column.Default = whole ? strings[whole[1]] : restoreQuoted(defaultMatch[1]);
    }

    const generatedMatch = rest.match(/\bGENERATED ALWAYS AS\s*(\((?:[^()]|\((?:[^()]|\([^()]*\))*\))*\))\s*(STORED|VIRTUAL)?/i);
    if (generatedMatch) {
        column.Generated = `${restoreQuoted(generatedMatch[1])}${generatedMatch[2] ? ` ${generatedMatch[2].toUpperCase()}` : ''}`;
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

/**
 * What versions before this one read from a column line. It cut some values
 * short: enum(...) became enum, 'System Generated' became System, and a type
 * like float(10,2), or a COLLATE before DEFAULT, lost NOT NULL and DEFAULT.
 * Used to recognise template JSON written by those versions.
 */
export const parseColumnDefinitionLegacy = (line) => {
    const columnMatch = /`([^`]+)`\s+([^\s,]+)(\s+NOT NULL|\s+NULL)?(\s+DEFAULT\s+([^,\s]+))?(\s+AUTO_INCREMENT)?/.exec(line);
    if (!columnMatch) return null;
    const typeMatch = line.match(/`[^`]+`\s+([a-zA-Z]+(?:\([0-9]+(?:,[0-9]+)?\))?)/i);
    const column = { Field: columnMatch[1], Type: typeMatch ? typeMatch[1] : null };
    if (columnMatch[3] && columnMatch[3].includes('NOT NULL')) column.NotNull = true;
    if (columnMatch[5]) column.Default = columnMatch[5].replace(/'/g, '');
    return column;
};
