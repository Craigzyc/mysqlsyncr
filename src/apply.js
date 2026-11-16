import { logger } from './loggers.js';
import { adaptSQLForServer, getServerVersion, portableCollation } from './versions.js';
import { transformSQLCode } from './normalizers.js';
import { randomBytes } from 'node:crypto';

// Cross-schema scheduling is internal: a caller-supplied JSON property cannot
// redirect an operation outside the database selected by the API.
const targetDatabase = Symbol('targetDatabase');
const isViewDependencyError = error => ['ER_NO_SUCH_TABLE', 'ER_VIEW_INVALID'].includes(error.code) || [1146, 1356].includes(error.errno);

const quoteString = (value) => `'${String(value).replace(/\\/g, '\\\\').replace(/'/g, "''")}'`;
const quoteIdentifier = value => `\`${String(value).replace(/`/g, '``')}\``;
const columnPosition = diff => 'after' in diff ? (diff.after === null ? ' FIRST' : ` AFTER ${quoteIdentifier(diff.after)}`) : '';

const addConstraintClause = constraint => {
    const columns = constraint.ColumnName.map(quoteIdentifier).join(', ');
    const referenced = (constraint.References.Columns || [].concat(constraint.References.Column)).map(quoteIdentifier).join(', ');
    const table = (constraint.References.Database ? `${quoteIdentifier(constraint.References.Database)}.` : '') + quoteIdentifier(constraint.References.Table);
    const action = value => {
        if (!['NO ACTION', 'RESTRICT', 'CASCADE', 'SET NULL', 'SET DEFAULT'].includes(value)) throw new Error(`Unsupported foreign key action: ${value}`);
        return value;
    };
    return `ADD CONSTRAINT ${quoteIdentifier(constraint.Name)} FOREIGN KEY (${columns}) REFERENCES ${table} (${referenced}) ON DELETE ${action(constraint.OnDelete || 'NO ACTION')} ON UPDATE ${action(constraint.OnUpdate || 'NO ACTION')}`;
};

// Types MySQL won't give a literal default
const noLiteralDefaultRegex = /^(tiny|medium|long)?(text|blob)$|^json$|^geometry|^point$|^linestring$|^polygon$/i;

const defaultClause = (field) => {
    const value = field.Default;
    if (field.DefaultQuoted) return `DEFAULT ${quoteString(value)}`;
    if (value === undefined || value === null || value === 'NULL') {
        // A NOT NULL column can't default to NULL; leave it without a default
        return field.NotNull ? '' : 'DEFAULT NULL';
    }
    // Functions, expressions, and bit/hex literals such as b'0' are written as they were read
    if (/^(CURRENT_TIMESTAMP|now)(\(\d*\))?$/i.test(value) || String(value).startsWith('(') || /^[bx]'[0-9a-f]*'$/i.test(value) || /^0x[0-9a-f]+$/i.test(value)) {
        return `DEFAULT ${value}`;
    }
    if (noLiteralDefaultRegex.test(field.Type)) {
        return '';
    }
    return `DEFAULT ${quoteString(value)}`;
}

// Template value for a column detail, or the live column's when the template doesn't record it
const columnDetail = (field, currentField, key) => key in field ? field[key] : currentField?.[key];

/**
 * Full column definition for ADD/CHANGE, e.g.
 *   timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
 * NULL/NOT NULL is always explicit: without it a timestamp is NOT NULL when
 * explicit_defaults_for_timestamp is OFF, and DEFAULT NULL then fails.
 * Charset, collation, comment, ON UPDATE and a generated column's expression
 * come from the template when it has them and are otherwise kept from the live
 * column, since CHANGE drops anything not restated.
 */
export const columnDefinition = (field, currentField) => {
    const charset = columnDetail(field, currentField, 'Charset');
    const collate = columnDetail(field, currentField, 'Collate');
    const onUpdate = columnDetail(field, currentField, 'OnUpdate');
    const comment = columnDetail(field, currentField, 'Comment');
    const generated = columnDetail(field, currentField, 'Generated');
    if (generated) {
        // A generated column takes no DEFAULT, ON UPDATE or AUTO_INCREMENT
        return [
            field.Type,
            charset ? `CHARACTER SET ${charset}` : '',
            collate ? `COLLATE ${collate}` : '',
            `GENERATED ALWAYS AS ${generated}`,
            field.NotNull ? 'NOT NULL' : 'NULL',
            comment ? `COMMENT ${quoteString(comment)}` : ''
        ].filter(Boolean).join(' ');
    }
    return [
        field.Type,
        charset ? `CHARACTER SET ${charset}` : '',
        collate ? `COLLATE ${collate}` : '',
        field.NotNull ? 'NOT NULL' : 'NULL',
        defaultClause(field),
        onUpdate ? `ON UPDATE ${onUpdate}` : '',
        field.AutoIncrement ? 'AUTO_INCREMENT' : '',
        comment ? `COMMENT ${quoteString(comment)}` : ''
    ].filter(Boolean).join(' ');
}

// `col`, or `col`(255) for a prefix index on a text column
const formatIndexColumns = (columns) => columns.map(col => {
    if (col.startsWith('(')) return col;
    const match = col.match(/^`?([^`(]+?)`?(?:\((\d+)\))?(?:\s+(ASC|DESC))?$/i);
    if (!match) throw new Error(`Invalid index column: ${col}`);
    return `${quoteIdentifier(match[1])}${match[2] ? `(${match[2]})` : ''}${match[3] ? ` ${match[3].toUpperCase()}` : ''}`;
}).join(', ');

const isPrimaryIndex = (index) => !!index.Primary || index.Name === 'PRIMARY';
const indexStructure = index => JSON.stringify([index.ColumnName, !!index.Unique || isPrimaryIndex(index), isPrimaryIndex(index), index.Type || 'BTREE']);

const addIndexClause = (index) => isPrimaryIndex(index)
    ? `ADD PRIMARY KEY (${formatIndexColumns(index.ColumnName)})`
    : `ADD ${index.Unique ? 'UNIQUE ' : ['FULLTEXT', 'SPATIAL'].includes(index.Type) ? `${index.Type} ` : ''}INDEX ${quoteIdentifier(index.Name)} (${formatIndexColumns(index.ColumnName)})${index.Type === 'HASH' ? ' USING HASH' : ''}${index.Visible === false ? ' INVISIBLE' : ''}`;

const dropIndexClause = (index) => isPrimaryIndex(index) ? 'DROP PRIMARY KEY' : `DROP INDEX \`${index.Name}\``;

const describeDifference = (diff) => {
    const name = diff.tableName || diff.viewName || diff.Name || diff.database || '';
    const detail = diff.field?.Field || diff.indexName || diff.constraintName || diff.trigger?.Name || (diff.key ? JSON.stringify(diff.key) : '');
    return `${diff.type} ${name}${detail ? '.' + detail : ''}`;
}

// Rewrites one collation in a CREATE TABLE, both as a table option (COLLATE=x) and as a
// column attribute (COLLATE x). Passing null for `to` removes the clause entirely.
const replaceCollation = (sql, from, to) => {
    const escaped = from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return transformSQLCode(sql, code => code
        .replace(new RegExp('COLLATE(\\s*)=(\\s*)' + escaped, 'gi'), to ? `COLLATE$1=$2${to}` : '')
        .replace(new RegExp('COLLATE(\\s+)' + escaped, 'gi'), to ? `COLLATE$1${to}` : ''));
};

// Rewrites that let DDL dumped from a newer server run on an older one. Each inspects the
// error the server actually returned and returns the amended SQL plus what changed, or
// null when it has nothing to offer - so a rewrite only ever fires for the failure it
// was written for, and anything else still surfaces as a failure. These catch what
// adaptSQLForServer can't anticipate, e.g. when the server's version couldn't be read.
const compatRewrites = [
    (sql, errorMessage) => {
        const unknown = /Unknown collation: '([^']+)'/i.exec(errorMessage);
        if (!unknown) return null;
        const substitute = portableCollation(unknown[1]);
        const rewritten = replaceCollation(sql, unknown[1], substitute);
        if (rewritten === sql) return null;
        return {
            sql: rewritten,
            message: `server does not support collation ${unknown[1]}, created with ${substitute || 'the charset default'} instead`,
        };
    },
    (sql, errorMessage) => {
        // Index visibility is MySQL 8.0.23+. Only strip the keyword where it is legal -
        // directly after an index definition's closing parenthesis - so the word cannot
        // be removed from a column comment or a column named `visible`.
        if (!/error in your SQL syntax/i.test(errorMessage) || !/\b(?:IN)?VISIBLE\b/i.test(errorMessage)) return null;
        const rewritten = sql.replace(/\)(\s+)(?:IN)?VISIBLE(?=\s*[,)\r\n])/g, ')');
        if (rewritten === sql) return null;
        return {
            sql: rewritten,
            message: 'server does not support index visibility, created with every index visible',
        };
    },
];

/**
 * Apply the differences in order. A failing difference doesn't stop the rest.
 * Returns { attempted, failures, warnings }: failures are the differences that
 * couldn't be applied, warnings the ones applied with a change for this server
 * (e.g. an 8.0 collation on 5.7), each as { type, tableName, description, message }.
 */
export const applyDifferences = async (connection, database, differences) => {
    const failures = [];
    const warnings = [];
    let deferredViews = [];
    let completedViews = 0;
    const scope = diff => diff[targetDatabase] ? { database: diff[targetDatabase] } : {};
    const fail = (diff, error) => {
        console.error(`Failed to apply ${describeDifference(diff)}: ${error.message}`);
        logger(diff);
        failures.push({ ...scope(diff), type: diff.type, tableName: diff.tableName, description: describeDifference(diff), message: error.message, ...(error.recoverySQL ? { recoverySQL: error.recoverySQL } : {}) });
    };
    const appliedTogether = new Set();
    const removedColumns = new Map();
    const indexRemovedWithColumns = (tableName, index) => index?.ColumnName?.length && index.ColumnName.every(column =>
        removedColumns.get(tableName)?.has(column.replace(/\s+(?:ASC|DESC)$/i, '').replace(/\(\d+\)$/, '')));
    let current = null; // the difference being applied, for warnings from query()
    const warn = (diff, message) => {
        console.warn(`Applied ${describeDifference(diff)} with a change: ${message}`);
        warnings.push({ ...scope(diff), type: diff.type, tableName: diff.tableName, description: describeDifference(diff), message });
    };

    // Template SQL from MySQL 8.0 can name collations a 5.7 server doesn't have
    const serverVersion = await getServerVersion(connection);
    const query = async (sql, values) => {
        const adapted = adaptSQLForServer(sql, serverVersion);
        if (adapted !== sql) {
            console.log(`Adapted for MySQL ${serverVersion}: ${adapted}`);
            if (current) warn(current, `MySQL ${serverVersion} required a charset/collation compatibility replacement; collation replacements are approximations and can change sort, accent/case and trailing-space comparisons`);
        }
        return connection.query(adapted, values);
    };

    // MySQL has no atomic CREATE OR REPLACE for procedures/triggers. Preserve
    // the live definition before dropping it, and recover it if CREATE fails.
    const replaceStoredObject = async (kind, name, definition, definitionKey) => {
        const [original] = await query(`SHOW CREATE ${kind} ${quoteIdentifier(name)}`);
        const previous = original?.[definitionKey];
        if (!previous) throw new Error(`Cannot replace ${kind.toLowerCase()} ${name}: its current definition could not be read`);
        await query(`DROP ${kind} ${quoteIdentifier(name)}`);
        try {
            await query(definition);
        } catch (error) {
            let session;
            try {
                if (original.sql_mode !== undefined) {
                    [session] = await query('SELECT @@SESSION.sql_mode AS sql_mode, @@SESSION.character_set_client AS character_set_client, @@SESSION.collation_connection AS collation_connection');
                    for (const setting of ['sql_mode', 'character_set_client', 'collation_connection']) {
                        if (original[setting] !== undefined) await query(`SET SESSION ${setting} = ?`, [original[setting]]);
                    }
                }
                await query(previous);
                error.message += `; original ${kind.toLowerCase()} restored`;
            } catch (restoreError) {
                error.message += `; restoring the original ${kind.toLowerCase()} also failed: ${restoreError.message}`;
                error.recoverySQL = previous;
            } finally {
                if (session) {
                    for (const setting of ['sql_mode', 'character_set_client', 'collation_connection']) {
                        try { await query(`SET SESSION ${setting} = ?`, [session[setting]]); }
                        catch (restoreError) { error.message += `; could not restore session ${setting}: ${restoreError.message}`; }
                    }
                }
            }
            throw error;
        }
    };

    // A dump written by MySQL 8 assumes explicit_defaults_for_timestamp is on, where a
    // `timestamp NOT NULL` column with no DEFAULT is just a column with no default. With
    // the MySQL 5.7 default of off, the server instead assigns every TIMESTAMP NOT NULL
    // column after the first an implicit '0000-00-00 00:00:00', which strict mode then
    // rejects at CREATE TABLE time. Matching MySQL 8 for this session applies that DDL as
    // written; DDL that states its defaults - everything SHOW CREATE TABLE emits, on
    // either version - parses the same way with the setting on or off.
    try {
        await connection.query('SET SESSION explicit_defaults_for_timestamp = 1');
    } catch (e) {
        logger(`Could not set explicit_defaults_for_timestamp for this session: ${e.message}`);
    }
   
    differences.sort((a, b) => {
        //Sort to make sure we apply the differences in a logical order.
        const typePriority = {
            'missing_database': 1,
            'missing_table': 2,
            'extra_table': 2,
            'extra_constraint': 1.5,
            'mismatched_table_options': 2.5,
            'missing_field': 3,
            'extra_field': 3,
            'mismatched_field': 3,
            'missing_index': 4,
            'extra_index': 4,
            'mismatched_index': 4,
            'missing_constraint': 4.5,
            'mismatched_constraint': 4.5,
            'missing_procedure': 5,
            'mismatched_procedure': 5,
            'missing_view': 6,
            'mismatched_view': 6,
            'extra_view': 6,
            'missing_trigger': 7,
            'mismatched_trigger': 7,
            'extra_trigger': 7,
            // after the table and its columns exist
            'missing_row': 8
        };
        
        return (typePriority[a.type] || 999) - (typePriority[b.type] || 999);
    })


    for (const diff of differences) {
        if (appliedTogether.has(diff)) continue;
        current = diff;
        try {

            if(diff.type == 'missing_database'){
                const createDatabaseSQL = `CREATE DATABASE \`${diff.database}\`;`;
                console.log(`Executing: ${createDatabaseSQL}`);
                await query(createDatabaseSQL);
                continue;
            }


            await query(`USE ${quoteIdentifier(diff[targetDatabase] || database)}`);
            if (diff.type === 'missing_table') {
                const { tableName, createSQL } = diff;
                logger(`Creating missing table ${tableName}`);
                console.log(`Executing: ${createSQL}`);
                try {
                    await query(createSQL);
                } catch (e) {
                    // The dump can name things this server has never heard of - a MySQL 8
                    // collation, index visibility. Amend the statement for whatever the
                    // server objected to and retry, one objection at a time, since it only
                    // reports the first. The table then exists, but not exactly as dumped,
                    // so record every change rather than calling it a clean success.
                    let sql = createSQL;
                    let error = e;
                    const changes = [];

                    while (error && changes.length < compatRewrites.length) {
                        const message = error.message;
                        const rewrite = compatRewrites.reduce((found, fn) => found || fn(sql, message), null);
                        if (!rewrite) break;

                        sql = rewrite.sql;
                        changes.push(rewrite.message);
                        console.log(`Retrying: ${sql}`);
                        try {
                            await query(sql);
                            error = null;
                        } catch (retryError) {
                            error = retryError;
                        }
                    }

                    if (error) throw error;
                    warn(diff, changes.join('; '));
                }

            } else if (diff.type === 'extra_table') {
                const { tableName } = diff;
                logger(`Dropping extra table ${tableName}`);
                const dropTableSQL = `DROP TABLE \`${tableName}\`;`;
                console.log(`Executing: ${dropTableSQL}`);
                await query(dropTableSQL);

            } else if (diff.type === 'missing_field') {
                // Existing rows get the column's default, or the type's implicit default for NOT NULL without one
                const requiredKey = diff.field.AutoIncrement && differences.find(candidate => candidate.type === 'missing_index' && candidate.tableName === diff.tableName && candidate.index.ColumnName[0]?.replace(/\(\d+\)$/, '') === diff.field.Field);
                const addFieldSQL = `ALTER TABLE ${quoteIdentifier(diff.tableName)} ADD COLUMN ${quoteIdentifier(diff.field.Field)} ${columnDefinition(diff.field)}${columnPosition(diff)}${requiredKey ? `, ${addIndexClause(requiredKey.index)}` : ''};`;
                console.log(`Executing: ${addFieldSQL}`);
                await query(addFieldSQL);
                if (requiredKey) appliedTogether.add(requiredKey);

            } else if (diff.type === 'extra_field') {
                const dropFieldSQL = `ALTER TABLE \`${diff.tableName}\` DROP COLUMN \`${diff.field.Field}\`;`;
                console.log(`Executing: ${dropFieldSQL}`);
                await query(dropFieldSQL);
                if (!removedColumns.has(diff.tableName)) removedColumns.set(diff.tableName, new Set());
                removedColumns.get(diff.tableName).add(diff.field.Field);

            } else if (diff.type === 'mismatched_field') {
                const { tableName, field, currentField } = diff;

                // MySQL requires AUTO_INCREMENT to be indexed in the same
                // ALTER that introduces it. A separate later ADD KEY fails.
                const requiredKey = field.AutoIncrement && differences.find(candidate => candidate.type === 'missing_index' && candidate.tableName === tableName && candidate.index.ColumnName[0]?.replace(/\(\d+\)$/, '') === field.Field);
                const modifyFieldSQL = `ALTER TABLE ${quoteIdentifier(tableName)} CHANGE ${quoteIdentifier(field.Field)} ${quoteIdentifier(field.Field)} ${columnDefinition(field, currentField)}${columnPosition(diff)}${requiredKey ? `, ${addIndexClause(requiredKey.index)}` : ''};`;
                console.log(`Executing: ${modifyFieldSQL}`);
                await query(modifyFieldSQL);
                if (requiredKey) appliedTogether.add(requiredKey);

            } else if (diff.type === 'missing_index') {
                const existingColumns = await query(`SHOW COLUMNS FROM \`${diff.tableName}\``);
                const columnNames = existingColumns.map(col => col.Field);

                // Check if all columns for the index exist
                const missingColumns = Array.isArray(diff.index.ColumnName) ? diff.index.ColumnName.filter(col => !col.startsWith('(') && !columnNames.includes(col.replace(/\s+(?:ASC|DESC)$/i, '').replace(/\(\d+\)$/, ''))) : [];

                if (missingColumns.length > 0) {
                    throw new Error(`Cannot create index ${diff.index.Name} on ${diff.tableName}. Missing columns: ${missingColumns.join(', ')}`);
                }

                if (!Array.isArray(diff.index.ColumnName) || diff.index.ColumnName.length === 0) {
                    throw new Error(`Cannot create index ${diff.index.Name} on ${diff.tableName}. ColumnName is undefined or empty.`);
                }
                const addIndexSQL = `ALTER TABLE \`${diff.tableName}\` ${addIndexClause(diff.index)};`;
                console.log(`Executing: ${addIndexSQL}`);
                await query(addIndexSQL);

            } else if (diff.type === 'extra_index') {
                // MySQL automatically removes an index when its final indexed
                // column is dropped. That completed the index removal too.
                if (indexRemovedWithColumns(diff.tableName, diff.index)) continue;
                const dropIndexSQL = `ALTER TABLE \`${diff.tableName}\` ${dropIndexClause(diff.index)};`;
                console.log(`Executing: ${dropIndexSQL}`);
                await query(dropIndexSQL);

            } else if (diff.type === 'mismatched_index') {
                const { tableName, index } = diff;
                if (diff.currentIndex && indexStructure(diff.currentIndex) === indexStructure(index)
                    && (diff.currentIndex.Visible !== false) !== (index.Visible !== false)) {
                    await query(`ALTER TABLE ${quoteIdentifier(tableName)} ALTER INDEX ${quoteIdentifier(index.Name)} ${index.Visible === false ? 'INVISIBLE' : 'VISIBLE'};`);
                    continue;
                }
                // Drop and re-add in one statement: the index is never missing if the add fails,
                // and a primary key on an AUTO_INCREMENT column can be replaced
                const replaceIndexSQL = `ALTER TABLE \`${tableName}\` ${indexRemovedWithColumns(tableName, diff.currentIndex) ? '' : `${dropIndexClause(index)}, `}${addIndexClause(index)};`;
                console.log(`Executing: ${replaceIndexSQL}`);
                await query(replaceIndexSQL);
                // MySQL can optimize a same-name DROP+ADD and retain the old
                // visibility. Explicitly apply the requested state afterwards.
                if (index.Visible === false) await query(`ALTER TABLE ${quoteIdentifier(tableName)} ALTER INDEX ${quoteIdentifier(index.Name)} INVISIBLE;`);

            } else if (diff.type === 'missing_constraint' || diff.type === 'mismatched_constraint' || diff.type === 'extra_constraint') {
                if (diff.type === 'mismatched_constraint') {
                    // With FK checks enabled MySQL uses a table-copy ALTER and
                    // rejects DROP+ADD of the same FK name. Use a distinct name
                    // for the validated replacement, then restore the template
                    // name in a second validated ALTER. A constraint remains
                    // enforced throughout; a failed first ALTER keeps the old one.
                    const temporary = { ...diff.constraint, Name: `mysqlsyncr_fk_${randomBytes(12).toString('hex')}` };
                    await query(`ALTER TABLE ${quoteIdentifier(diff.tableName)} DROP FOREIGN KEY ${quoteIdentifier(diff.currentConstraint?.Name || diff.constraint.Name)}, ${addConstraintClause(temporary)};`);
                    const finalize = `ALTER TABLE ${quoteIdentifier(diff.tableName)} DROP FOREIGN KEY ${quoteIdentifier(temporary.Name)}, ${addConstraintClause(diff.constraint)};`;
                    try { await query(finalize); }
                    catch (error) {
                        error.message += `; replacement remains enforced as ${temporary.Name}, but its final name could not be restored`;
                        error.recoverySQL = finalize;
                        throw error;
                    }
                    continue;
                }
                const clauses = [];
                if (diff.type !== 'missing_constraint') clauses.push(`DROP FOREIGN KEY ${quoteIdentifier(diff.currentConstraint?.Name || diff.constraint.Name)}`);
                if (diff.type !== 'extra_constraint') clauses.push(addConstraintClause(diff.constraint));
                await query(`ALTER TABLE ${quoteIdentifier(diff.tableName)} ${clauses.join(', ')};`);

            } else if (diff.type === 'mismatched_table_options') {
                const clauses = [];
                for (const [key, value] of Object.entries(diff.options || {})) {
                    if (!/^[a-zA-Z0-9_]+$/.test(value)) throw new Error(`Invalid table option ${key}: ${value}`);
                    const keyword = { engine: 'ENGINE', charset: 'DEFAULT CHARACTER SET', collate: 'COLLATE' }[key];
                    if (!keyword) throw new Error(`Unknown table option ${key}`);
                    clauses.push(`${keyword}=${value}`);
                }
                if (!clauses.length) throw new Error('No table options to apply');
                await query(`ALTER TABLE ${quoteIdentifier(diff.tableName)} ${clauses.join(' ')};`);

            } else if (diff.type === 'missing_procedure' || diff.type === 'mismatched_procedure') {
                if (diff.type === 'mismatched_procedure') await replaceStoredObject('PROCEDURE', diff.Name, diff.Definition, 'Create Procedure');
                else await query(diff.Definition);



            } else if (diff.type === 'missing_view' || diff.type === 'mismatched_view') {
                // An invalid replacement must leave the existing view intact.
                const createViewSQL = diff.definition.replace(/^\s*CREATE\s+(?:OR\s+REPLACE\s+)?/i, 'CREATE OR REPLACE ');
                console.log(`Executing: ${createViewSQL}`);
                await query(createViewSQL);
                completedViews++;


            } else if (diff.type === 'extra_view') {
                const dropViewSQL = `DROP VIEW IF EXISTS \`${diff.viewName}\`;`;
                console.log(`Executing: ${dropViewSQL}`);
                await query(dropViewSQL);


            } else if (diff.type === 'missing_trigger') {
                const createTriggerSQL = diff.trigger.Definition;
                logger('fixing trigger', diff.trigger.Name)
                console.log(`Executing: ${createTriggerSQL}`);
                await query(createTriggerSQL);


            } else if (diff.type === 'mismatched_trigger') {
                await replaceStoredObject('TRIGGER', diff.trigger.Name, diff.trigger.Definition, 'SQL Original Statement');


            } else if (diff.type === 'extra_trigger') {
                const dropTriggerSQL = `DROP TRIGGER IF EXISTS \`${diff.trigger.Name}\`;`;
                console.log(`Executing: ${dropTriggerSQL}`);
                await query(dropTriggerSQL);

            } else if (diff.type === 'missing_row') {
                const columns = Object.keys(diff.row);
                const insertRowSQL = `INSERT INTO \`${diff.tableName}\` (${columns.map(col => `\`${col}\``).join(', ')}) VALUES (${columns.map(() => '?').join(', ')});`;
                console.log(`Executing: ${insertRowSQL}`, JSON.stringify(diff.row));
                await query(insertRowSQL, columns.map(col => diff.row[col]));

            }else if(diff.type === 'missing_database'){
                logger('fixing missing database', diff.database)
                const createDatabaseSQL = `CREATE DATABASE \`${diff.database}\`;`;
                console.log(`Executing: ${createDatabaseSQL}`);
                await query(createDatabaseSQL);
            } else {
                throw new Error(`Unknown difference type: ${diff.type}`);
            }
        } catch (e) {
            if (['missing_view', 'mismatched_view'].includes(diff.type) && isViewDependencyError(e)) deferredViews.push({ diff, error: e });
            else fail(diff, e);
        }
    }

    // Templates may list a view before the view it selects from. Retry only
    // known dependency errors and only while another view made progress. Cycles,
    // missing objects, permission failures and syntax errors remain failures.
    while (deferredViews.length && completedViews > 0) {
        const pending = deferredViews;
        deferredViews = [];
        completedViews = 0;
        for (const { diff } of pending) {
            current = diff;
            try {
                await query(`USE ${quoteIdentifier(diff[targetDatabase] || database)}`);
                await query(diff.definition.replace(/^\s*CREATE\s+(?:OR\s+REPLACE\s+)?/i, 'CREATE OR REPLACE '));
                completedViews++;
            } catch (error) {
                if (isViewDependencyError(error)) deferredViews.push({ diff, error });
                else fail(diff, error);
            }
        }
    }
    for (const { diff, error } of deferredViews) fail(diff, error);

    return { attempted: differences.length, failures, warnings };
}

// Used by the global view phase so a view in schema A can depend on one in Z.
export const applyViewsAcrossDatabases = (connection, allDifferences) => applyDifferences(connection, null,
    Object.entries(allDifferences).flatMap(([database, differences]) => differences
        .filter(diff => ['missing_view', 'mismatched_view', 'extra_view'].includes(diff.type))
        .map(diff => ({ ...diff, [targetDatabase]: database }))));

// One line summing up the failures from applyDifferences, for errors and logs
export const describeFailures = ({ attempted, failures }) =>
    `${failures.length} of ${attempted} difference(s) failed to apply: ${failures.map(f => `${f.description} (${f.message})`).join('; ')}`;
