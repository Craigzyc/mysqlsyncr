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

    // Regular expression to match column definitions
    const columnRegex = /`([^`]+)`\s+([^\s,]+)(\s+NOT NULL|\s+NULL)?(\s+DEFAULT\s+([^,\s]+))?(\s+AUTO_INCREMENT)?/;

    // Regular expression to match index definitions
    const indexRegex = /(PRIMARY|UNIQUE)?\s*KEY\s*`([^`]+)`\s*\(([^)]+)\)|PRIMARY KEY\s*\(([^)]+)\)/;

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
    // Match type pattern including parameters, handling both single and double parameter types
    const typeRegex = /`[^`]+`\s+([a-zA-Z]+(?:\([0-9]+(?:,[0-9]+)?\))?)/i;
    const match = line.match(typeRegex);
    
    if (!match) return null;
    return match[1]; // Returns the full type including parameters
};
