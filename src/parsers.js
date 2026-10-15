// A single-quoted SQL string literal, '' being an escaped quote inside one.
const QUOTED_STRING = "'(?:[^']|'')*'";

// A column type with its optional argument list. The list is not always numeric:
// enum('INSERT','UPDATE','DELETE') and set('a','b') carry quoted values, and those
// values can themselves contain commas or parentheses, so quoted strings are matched
// as opaque units and cannot terminate the list early.
const TYPE_PATTERN = "[a-zA-Z]+(?:\\((?:" + QUOTED_STRING + "|[^')])*\\))?";

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

    // Regular expression to match column definitions.
    // The non-capturing group after the type skips the attributes MySQL renders between
    // the type and the NULL/DEFAULT clauses, e.g.
    //   `IID` varchar(25) COLLATE utf8mb4_unicode_ci DEFAULT NULL
    //   `qty` int(11) unsigned NOT NULL DEFAULT '0'
    // Without it those optional groups sit at the wrong offset and fail to match, so the
    // column silently parses with no Default/NotNull. Casing follows SHOW CREATE TABLE
    // output, which is what this parser is always fed.
    // The type uses TYPE_PATTERN rather than a comma-free run: `float(10,2)` and
    // `enum('a','b')` end at the first comma otherwise, which pushes every later group
    // out of position and silently drops NotNull/Default/AutoIncrement. The DEFAULT
    // value likewise accepts a quoted string, so a default containing a space
    // (DEFAULT 'System Generated') is not truncated at the space.
    const columnRegex = new RegExp(
        '`([^`]+)`\\s+(' + TYPE_PATTERN + ')' +
        '(?:\\s+unsigned|\\s+zerofill|\\s+CHARACTER SET \\w+|\\s+COLLATE \\w+)*' +
        '(\\s+NOT NULL|\\s+NULL)?' +
        '(\\s+DEFAULT\\s+(' + QUOTED_STRING + '|[^,\\s]+))?' +
        '(\\s+AUTO_INCREMENT)?'
    );

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
        // Check if the line contains a column definition
        const columnMatch = columnRegex.exec(line);
        const indexMatch = indexRegex.exec(line);
        const indexMatch_Old = indexRegex_Old.exec(line);

        const constraintMatch = parseConstraint(line);
        if (columnMatch && !indexMatch && !constraintMatch) {
            const columnType = parseColumnType(line);
            const column = {
                Field: columnMatch[1],
                Type: columnType
            };

            // Set Null property based on NOT NULL presence
            if (columnMatch[3] && columnMatch[3].includes('NOT NULL')) {
                column.NotNull = true; // Set to false if NOT NULL is present
            }

            // Set Default property if it exists
            if (columnMatch[5]) {
                // console.log('columnMatch[5]', columnMatch[5], columnMatch[5].replace(/'/g, ''))
                column.Default = columnMatch[5].replace(/'/g, '');
            }

            // Set AutoIncrement property if it exists
            if (columnMatch[6]) {
                column.AutoIncrement = true; // Set to true if AUTO_INCREMENT is present
            }

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

const parseColumnType = (line) => {
    // Match type pattern including parameters. A numeric-only argument list silently
    // truncated enum('INSERT','UPDATE','DELETE') and set('a','b') to a bare `enum`/`set`,
    // losing the values entirely - see TYPE_PATTERN.
    const typeRegex = new RegExp('`[^`]+`\\s+(' + TYPE_PATTERN + ')', 'i');
    const match = line.match(typeRegex);
    
    if (!match) return null;
    return match[1]; // Returns the full type including parameters
};
