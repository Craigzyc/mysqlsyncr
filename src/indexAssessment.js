import mysql from 'mysql2';

const unknown = (reason) => ({ status: 'inconclusive', summary: reason, tables: [] });

// A conservative tokenizer for automatic EXPLAIN. Reject unknown syntax rather
// than risk evaluating functions, views, or multiple statements. Nested SELECTs
// are supported only as IN/EXISTS predicates, with unambiguous table aliases.
export function inspectSample(sql, defaultSchema) {
    if (typeof sql !== 'string' || sql.length > 65536) return null;
    const text = sql.trim().replace(/;$/, '');
    const token = /\s+|'(?:''|\\.|[^'\\])*'|`(?:``|[^`])+`|[A-Za-z_][A-Za-z0-9_$]*|\d+(?:\.\d+)?|<=|>=|<>|!=|[(),.*=<>+\/-]/gy;
    const tokens = [];
    let offset = 0;
    while (offset < text.length) {
        token.lastIndex = offset;
        const match = token.exec(text);
        if (!match) return null;
        offset = token.lastIndex;
        if (!/^\s+$/.test(match[0])) tokens.push(match[0]);
    }
    const upper = tokens.map(value => value.toUpperCase());
    if (upper[0] !== 'SELECT') return null;
    if (upper.some(value => ['INTO', 'OUTFILE', 'DUMPFILE', 'FOR', 'LOCK', 'UNION', 'PROCEDURE', 'WITH', 'NATURAL', 'SQL_CALC_FOUND_ROWS'].includes(value))) return null;
    if (text.includes('/*') || text.includes('--') || text.includes('#')) return null;
    // No function calls (including stored functions). IN (...) is supported.
    for (let i = 1; i < tokens.length; i++) {
        if (tokens[i] === '(' && /^(?:[A-Za-z_]|`)/.test(tokens[i - 1]) && !['IN', 'EXISTS', 'AND', 'OR', 'WHERE', 'ON', 'NOT'].includes(upper[i - 1])) return null;
    }
    const scopes = [], tokenScopes = [], parentheses = [];
    let currentScope = null;
    for (let i = 0; i < tokens.length; i++) {
        if (upper[i] === 'SELECT') {
            if (i !== 0 && (tokens[i - 1] !== '(' || !['IN', 'EXISTS'].includes(upper[i - 2]))) return null;
            if (scopes.length >= 8) return null;
            const scope = { id: scopes.length, parent: currentScope, tables: [], condition: false };
            scopes.push(scope);
            currentScope = scope;
        }
        tokenScopes[i] = currentScope;
        if (tokens[i] === '(') parentheses.push(currentScope);
        if (tokens[i] === ')') {
            if (!parentheses.length) return null;
            currentScope = parentheses.pop();
        }
    }
    if (parentheses.length) return null;
    const identifier = value => value && (/^[A-Za-z_][A-Za-z0-9_$]*$/.test(value) || /^`(?:``|[^`])+`$/.test(value));
    const unquote = value => value.startsWith('`') ? value.slice(1, -1).replace(/``/g, '`') : value;
    const reserved = new Set(['WHERE', 'JOIN', 'LEFT', 'RIGHT', 'INNER', 'OUTER', 'CROSS', 'ON', 'USING', 'GROUP', 'ORDER', 'LIMIT', 'HAVING', 'OFFSET', 'ASC', 'DESC', 'STRAIGHT_JOIN', 'USE', 'FORCE', 'IGNORE', 'PARTITION']);
    const tables = [];
    for (let i = 0; i < tokens.length; i++) {
        if (!['FROM', 'JOIN'].includes(upper[i])) continue;
        let j = i + 1;
        if (!identifier(tokens[j])) return null;
        let schema = defaultSchema;
        let name = unquote(tokens[j++]);
        if (tokens[j] === '.') {
            schema = name;
            if (!identifier(tokens[j + 1])) return null;
            name = unquote(tokens[j + 1]);
            j += 2;
        }
        let alias = name;
        if (upper[j] === 'AS') {
            if (!identifier(tokens[++j])) return null;
            alias = unquote(tokens[j++]);
        } else if (identifier(tokens[j]) && !reserved.has(upper[j])) alias = unquote(tokens[j++]);
        // Implicit comma joins and table/index hints are outside this subset.
        if (tokens[j] === ',' || ['USE', 'FORCE', 'IGNORE', 'PARTITION', 'STRAIGHT_JOIN'].includes(upper[j])) return null;
        if (!schema || ['mysql', 'sys', 'performance_schema', 'information_schema'].includes(schema.toLowerCase())) return null;
        // Reused aliases across query blocks cannot be safely mapped after
        // semijoin rewrites with traditional EXPLAIN. Keep these inconclusive.
        if (tables.some(table => table.alias === alias)) return null;
        const table = { schema, name, alias };
        tables.push(table);
        tokenScopes[i].tables.push(table);
    }
    if (!tables.length || tables.length > 8 || upper.includes('STRAIGHT_JOIN')) return null;
    const comparisons = new Set(['=', '<', '>', '<=', '>=', '<>', '!=', 'IS', 'LIKE', 'IN', 'BETWEEN']);
    const conditionAliases = new Set();
    const leadingWildcardAliases = new Set();
    const unqualifiedPredicates = new Map();
    let hasColumnCondition = false;
    for (let i = 0; i < tokens.length; i++) {
        const scope = tokenScopes[i];
        if (['WHERE', 'ON', 'USING', 'HAVING'].includes(upper[i])) scope.condition = true;
        if (['GROUP', 'ORDER', 'LIMIT'].includes(upper[i])) scope.condition = false;
        if (upper[i] === 'USING' && scope.tables.length > 1) {
            hasColumnCondition = true;
            scope.tables.forEach(table => conditionAliases.add(table.alias));
        }
        if (!scope.condition) continue;
        if (!identifier(tokens[i]) || ['NULL', 'TRUE', 'FALSE', 'NOT', 'AND', 'OR', 'IN', 'EXISTS'].includes(upper[i])) continue;
        if (!comparisons.has(upper[i + 1]) && !comparisons.has(upper[i - 1])) continue;
        hasColumnCondition = true;
        let alias;
        if (tokens[i - 1] === '.' && identifier(tokens[i - 2])) alias = unquote(tokens[i - 2]);
        else if (tokens[i + 1] === '.' && identifier(tokens[i + 2])) alias = unquote(tokens[i]);
        else if (scope.tables.length === 1) {
            alias = scope.tables[0].alias;
            if (!unqualifiedPredicates.has(alias)) unqualifiedPredicates.set(alias, new Set());
            unqualifiedPredicates.get(alias).add(unquote(tokens[i]).toLowerCase());
        }
        // Qualified correlated references may resolve in an enclosing block.
        let visible = scope;
        while (visible && !visible.tables.some(table => table.alias === alias)) visible = visible.parent;
        if (visible) {
            conditionAliases.add(alias);
            if (upper[i + 1] === 'LIKE' && /^'[%_]/.test(tokens[i + 2] || '')) leadingWildcardAliases.add(alias);
        }
    }
    if (scopes.some(scope => !scope.tables.length)) return null;
    return { sql: text, tables, hasConditions: hasColumnCondition, conditionAliases, leadingWildcardAliases,
        hasSubqueries: scopes.length > 1, unqualifiedPredicates };
}

function groupIndexes(rows) {
    const indexes = new Map();
    for (const row of rows) {
        if (!indexes.has(row.INDEX_NAME)) indexes.set(row.INDEX_NAME, { name: row.INDEX_NAME, unique: !Number(row.NON_UNIQUE), columns: [] });
        indexes.get(row.INDEX_NAME).columns.push({ name: row.COLUMN_NAME, prefixLength: row.SUB_PART });
    }
    return [...indexes.values()];
}

export async function assessQueryIndexes(connection, row, sample, minimumScanRows = 1000) {
    const parsed = inspectSample(sample, row.database_name);
    if (!parsed) return unknown('No supported complete SELECT sample is available. Simple SELECTs and nested IN/EXISTS subqueries with distinct aliases are supported; functions, views, derived tables, repeated aliases, writes, and complex syntax are skipped.');
    try {
        const existing = new Map();
        for (const table of parsed.tables) {
            const [metadata] = await connection.query(`SELECT TABLE_TYPE FROM information_schema.TABLES
                WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?`, [table.schema, table.name]);
            if (metadata[0]?.TABLE_TYPE !== 'BASE TABLE') return unknown('A referenced table is a view, is missing, or is not visible to this account.');
            if (parsed.hasSubqueries && parsed.unqualifiedPredicates.has(table.alias)) {
                const [columns] = await connection.query(`SELECT COLUMN_NAME FROM information_schema.COLUMNS
                    WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?`, [table.schema, table.name]);
                const localColumns = new Set(columns.map(column => column.COLUMN_NAME.toLowerCase()));
                if ([...parsed.unqualifiedPredicates.get(table.alias)].some(column => !localColumns.has(column))) {
                    return unknown('An unqualified predicate in a nested SELECT could not be verified against its local table. Use explicit aliases for correlated columns or check metadata permissions.');
                }
            }
            const [indexes] = await connection.query(`SELECT INDEX_NAME, NON_UNIQUE, COLUMN_NAME, SEQ_IN_INDEX, SUB_PART
                FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
                ORDER BY INDEX_NAME, SEQ_IN_INDEX`, [table.schema, table.name]);
            existing.set(table.alias, { ...table, existingIndexes: groupIndexes(indexes) });
        }
        // USE affects only the dedicated monitoring connection. Never ANALYZE:
        // EXPLAIN ANALYZE would execute the captured application query.
        await connection.query(`USE ${mysql.escapeId(row.database_name, true)}`);
        let plan;
        try {
            [plan] = await connection.query(`EXPLAIN FORMAT=TRADITIONAL ${parsed.sql}`);
        } catch (error) {
            // MySQL 5.5 has no FORMAT option; its plain EXPLAIN is already traditional.
            if (error.code !== 'ER_PARSE_ERROR') throw error;
            [plan] = await connection.query(`EXPLAIN ${parsed.sql}`);
        }
        const materialized = step => parsed.hasSubqueries && /^<subquery\d+>$/.test(step.table || '');
        if (plan.some(step => step.table && !existing.has(step.table) && !materialized(step))) return unknown('The execution plan contains tables that could not be mapped unambiguously to the sample.');
        const notes = [];
        if (plan.some(materialized)) notes.push('MySQL materializes a subquery into an internal result. Its generated lookup key is not an index on a base table; base-table access is assessed separately.');
        if (parsed.hasSubqueries) notes.push('The complete nested query was planned together. MySQL may rewrite it as a semijoin or materialize a subquery; this is an estimated plan, not an execution benchmark.');
        const tables = [];
        for (const step of plan) {
            const table = existing.get(step.table);
            if (!table) continue;
            const scan = ['ALL', 'index'].includes(step.type);
            const substantial = Number(step.rows) >= minimumScanRows;
            const possible = step.possible_keys ? String(step.possible_keys).split(',') : [];
            let status = 'no_index_issue_evident';
            let reason = 'This sample plan does not show a substantial full scan. Slowness may have another cause.';
            if (scan && substantial && parsed.conditionAliases.has(table.alias)) {
                status = possible.length ? 'review_existing_indexes' : 'index_may_help';
                reason = possible.length
                    ? 'The optimizer considered existing indexes but chose a scan. Review selectivity, statistics, and query shape before adding another index.'
                    : 'The plan estimates a substantial scan with filtering/join conditions and no usable lookup index. A suitable index may help; confirm selectivity and column order before creating one.';
            } else if (scan && substantial && parsed.hasConditions) {
                status = 'inconclusive';
                reason = 'A substantial scan exists, but predicates could not be assigned unambiguously to this table. Review the query before recommending an index.';
            } else if (scan && substantial) {
                status = 'scan_without_filter';
                reason = 'A substantial scan is planned without a recognized indexable column condition. Adding an index alone may not reduce the work; review the amount of data requested.';
            } else if (!scan && step.key) {
                status = 'index_used';
                reason = `The plan already uses ${step.key} for ${step.type} access. An index is not automatically missing because the query was slow.`;
            }
            if (parsed.leadingWildcardAliases.has(table.alias)) {
                reason += ' A LIKE value starts with a wildcard, preventing a prefix range lookup for that predicate. Other predicates or a covering index may still benefit from indexing.';
            }
            tables.push({ ...table, accessType: step.type, chosenIndex: step.key, possibleIndexes: possible,
                estimatedRows: step.rows, extra: step.Extra, status, reason });
        }
        if (!tables.length) return unknown('The execution plan did not expose a directly mapped base table.');
        const priority = ['index_may_help', 'review_existing_indexes', 'inconclusive', 'scan_without_filter', 'no_index_issue_evident', 'index_used'];
        const status = priority.find(value => tables.some(table => table.status === value));
        return { status, summary: 'Based on an estimated plan for one captured sample and current indexes; it may differ from the historical slow execution.', tables, notes };
    } catch (error) {
        // Database errors can echo literal sample values; expose only the code.
        return unknown(`Plan/index inspection was unavailable (${error.code || 'QUERY_ERROR'}). Check permissions, sample completeness, and server compatibility.`);
    }
}

export async function assessPerformanceRows(connection, rows, warnings) {
    const cache = new Map();
    let hasSampleColumn = true;
    for (const row of rows) {
        const key = JSON.stringify([row.database_name, row.digest]);
        if (cache.has(key)) { row.indexAssessment = cache.get(key); continue; }
        let sample;
        try {
            if (hasSampleColumn) {
                try {
                    const [samples] = await connection.query(`SELECT QUERY_SAMPLE_TEXT AS sample_sql
                        FROM performance_schema.events_statements_summary_by_digest
                        WHERE SCHEMA_NAME <=> ? AND DIGEST = ? LIMIT 1`, [row.database_name, row.digest]);
                    sample = samples[0]?.sample_sql;
                } catch (error) {
                    if (error.code !== 'ER_BAD_FIELD_ERROR') throw error;
                    hasSampleColumn = false;
                }
            }
            if (!sample) {
                const [history] = await connection.query(`SELECT SQL_TEXT AS sample_sql
                    FROM performance_schema.events_statements_history_long
                    WHERE CURRENT_SCHEMA <=> ? AND DIGEST = ? AND SQL_TEXT IS NOT NULL
                    ORDER BY TIMER_WAIT DESC LIMIT 1`, [row.database_name, row.digest]);
                sample = history[0]?.sample_sql;
            }
            row.indexAssessment = await assessQueryIndexes(connection, row, sample);
        } catch (error) {
            row.indexAssessment = unknown(`A captured sample could not be read (${error.code || 'QUERY_ERROR'}).`);
        }
        cache.set(key, row.indexAssessment);
    }
    if (rows.some(row => row.indexAssessment.status === 'inconclusive')) {
        warnings.push('Some queries could not be assessed automatically. Missing samples, unsupported SQL, or insufficient permissions are reported as inconclusive, not as healthy indexes.');
    }
}
