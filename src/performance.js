import mysql from 'mysql2';
import { assessPerformanceRows } from './indexAssessment.js';
import { collectDiagnostics } from './performanceDiagnostics.js';
import { collectDuplicateIndexes } from './duplicateIndexes.js';
import { collectServerHealth, finalizeLockContention, buildNotifications } from './serverHealth.js';

export function performanceOptions(options = {}) {
    const result = {};
    for (const [name, fallback, min, max, integer] of [
        ['slowMs', 2000, 1000, 86400000, false],
        ['minExecutions', 6, 1, 1000000000, true],
        ['minRowsExamined', 1000, 1, 1000000000000, true],
        ['scanRatio', 1000, 1, 1000000000, false],
        ['limit', 10, 1, 100, true],
    ]) {
        const value = options[name] === undefined ? fallback : options[name];
        if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value))) {
            const error = new Error(`${name} must be ${integer ? 'an integer' : 'a number'} between ${min} and ${max}.`);
            error.code = 'INVALID_PERFORMANCE_OPTIONS';
            throw error;
        }
        result[name] = value;
    }
    return result;
}

// This accepts a dedicated mysql2 promise connection. Application SELECT samples
// are planned with EXPLAIN, not executed; the connection's default schema changes.
export async function collectPerformanceReport(connection, options = {}) {
    const thresholds = performanceOptions(options);
    const database = options.database || null;
    if (database !== null && typeof database !== 'string') {
        const error = new Error('database must be a schema name.');
        error.code = 'INVALID_PERFORMANCE_OPTIONS';
        throw error;
    }
    const report = {
        checkedAt: new Date().toISOString(), database, thresholds,
        available: false, warnings: [], slowQueries: [], indexCandidates: [],
        highestTotalTime: [], tempAndSortQueries: [], duplicateIndexes: [],
    };
    // Index metadata does not depend on Performance Schema, so check it first.
    try {
        report.duplicateIndexes = await collectDuplicateIndexes(connection, database);
    } catch (error) {
        report.warnings.push(`Duplicate index check failed: ${error.message}`);
    }
    report.serverHealth = await collectServerHealth(connection, report.warnings);
    const finish = () => {
        finalizeLockContention(report.serverHealth, report.diagnostics?.lockWaits?.rows || []);
        report.notifications = buildNotifications(report);
        return report;
    };
    const [[status]] = await connection.query('SELECT @@performance_schema AS enabled, @@version AS version');
    report.serverVersion = status.version || null;
    const [major, minor] = String(status.version || '').split('.').map(Number);
    if (major === 5 && minor < 6) {
        // Statement digests arrived in MySQL 5.6. Index and server health checks still apply.
        report.warnings.push(`MySQL ${status.version} has no statement digest statistics (requires 5.6+). Slow query and needed-index checks are unavailable; duplicate index and server health checks still ran.`);
        return finish();
    }
    if (!Number(status.enabled)) {
        report.warnings.push('Performance Schema is disabled. Enable it in the MySQL server configuration and restart the server to collect query statistics.');
        return finish();
    }
    const [consumers] = await connection.query("SELECT ENABLED FROM performance_schema.setup_consumers WHERE NAME = 'statements_digest'");
    if (!consumers.length || consumers[0].ENABLED !== 'YES') {
        report.warnings.push('The statements_digest consumer is disabled; query statistics may be missing or stale.');
    }
    const [instruments] = await connection.query("SELECT COUNT(*) AS enabled, COALESCE(SUM(TIMED = 'YES'), 0) AS timed FROM performance_schema.setup_instruments WHERE NAME LIKE 'statement/%' AND ENABLED = 'YES'");
    if (!Number(instruments[0].enabled)) report.warnings.push('Statement instruments are disabled; query statistics may be missing or stale.');
    else if (Number(instruments[0].timed) < Number(instruments[0].enabled)) report.warnings.push('Some enabled statement instruments are not timed; slow query results may be incomplete.');

    const scope = database ? 'SCHEMA_NAME = ?' : "SCHEMA_NAME IS NOT NULL AND SCHEMA_NAME NOT IN ('mysql', 'sys', 'performance_schema', 'information_schema')";
    const params = database ? [database] : [];
    const applicationQueries = `DIGEST_TEXT NOT REGEXP '^(SHOW|EXPLAIN|DESCRIBE|DESC|SET|USE)[[:space:]]'
        AND REPLACE(UPPER(DIGEST_TEXT), CHAR(96), '') NOT REGEXP '(^|[^A-Z0-9_])(INFORMATION_SCHEMA|PERFORMANCE_SCHEMA|MYSQL|SYS)[[:space:]]*[.]'`;
    const select = `SELECT SCHEMA_NAME AS database_name, DIGEST AS digest,
        DIGEST_TEXT AS query_text, COUNT_STAR AS execution_count,
        SUM_ROWS_EXAMINED AS rows_examined, SUM_ROWS_SENT AS rows_sent,
        SUM_NO_INDEX_USED AS no_index_used, SUM_NO_GOOD_INDEX_USED AS no_good_index_used,
        SUM_CREATED_TMP_TABLES AS tmp_tables, SUM_CREATED_TMP_DISK_TABLES AS disk_tmp_tables,
        SUM_SORT_ROWS AS sort_rows, SUM_SORT_MERGE_PASSES AS sort_merge_passes,
        SUM_SORT_SCAN AS sort_scans, SUM_SORT_RANGE AS sort_ranges,
        AVG_TIMER_WAIT / 1000000000 AS avg_ms,
        MAX_TIMER_WAIT / 1000000000 AS max_ms,
        SUM_TIMER_WAIT / 1000000000 AS total_ms,
        SUM_ROWS_EXAMINED / GREATEST(SUM_ROWS_SENT, 1) AS scan_ratio,
        FIRST_SEEN AS first_seen, LAST_SEEN AS last_seen
        FROM performance_schema.events_statements_summary_by_digest
        WHERE DIGEST IS NOT NULL AND ${scope} AND ${applicationQueries} AND COUNT_STAR >= ?`;
    const [slow] = await connection.query(`${select}
        AND MAX_TIMER_WAIT > ? ORDER BY SUM_TIMER_WAIT DESC LIMIT ?`,
    [...params, thresholds.minExecutions, thresholds.slowMs * 1000000000, thresholds.limit]);
    const [indexes] = await connection.query(`${select}
        AND MAX_TIMER_WAIT > ? AND SUM_ROWS_EXAMINED >= ?
        AND (SUM_NO_INDEX_USED > 0 OR SUM_NO_GOOD_INDEX_USED > 0
            OR SUM_ROWS_EXAMINED > GREATEST(SUM_ROWS_SENT, 1) * ?)
        ORDER BY SUM_ROWS_EXAMINED DESC LIMIT ?`,
    [...params, thresholds.minExecutions, thresholds.slowMs * 1000000000, thresholds.minRowsExamined, thresholds.scanRatio, thresholds.limit]);
    const [[coverage]] = await connection.query(`SELECT COUNT(*) AS digest_count
        FROM performance_schema.events_statements_summary_by_digest
        WHERE DIGEST IS NOT NULL AND ${scope} AND ${applicationQueries}`, params);
    if (!Number(coverage.digest_count)) report.warnings.push('No statement digests are available for this scope. This does not establish that queries are fast or indexes are adequate. Check instrumentation, permissions, and workload.');
    report.available = true;
    report.slowQueries = slow;
    report.indexCandidates = indexes;
    const [highest] = await connection.query(`${select} AND MAX_TIMER_WAIT > ? ORDER BY SUM_TIMER_WAIT DESC LIMIT ?`,
        [...params, thresholds.minExecutions, thresholds.slowMs * 1000000000, thresholds.limit]);
    report.highestTotalTime = highest;
    const [tempAndSort] = await connection.query(`${select}
        AND MAX_TIMER_WAIT > ?
        AND (SUM_CREATED_TMP_TABLES > 0 OR SUM_SORT_ROWS > 0 OR SUM_SORT_MERGE_PASSES > 0 OR SUM_SORT_SCAN > 0 OR SUM_SORT_RANGE > 0)
        ORDER BY SUM_TIMER_WAIT DESC LIMIT ?`, [...params, thresholds.minExecutions, thresholds.slowMs * 1000000000, thresholds.limit]);
    report.tempAndSortQueries = tempAndSort;
    await collectDiagnostics(connection, report, select, params, options);
    await assessPerformanceRows(connection, [...slow, ...indexes], report.warnings);
    const assessments = new Map([...slow, ...indexes].map(row => [JSON.stringify([row.database_name, row.digest]), row.indexAssessment]));
    for (const row of [...highest, ...tempAndSort]) {
        const assessment = assessments.get(JSON.stringify([row.database_name, row.digest]));
        if (assessment) row.indexAssessment = assessment;
    }
    report.warnings.push('Statistics are cumulative since collection began or was reset, not a recent time window. Index candidates require execution-plan review; scans can be appropriate.');
    return finish();
}

export async function checkPerformance(config, options = {}) {
    // Validate before opening a connection and keep UI-only settings out of mysql2.
    performanceOptions(options);
    const { host, port, user, password, socketPath, ssl, connectTimeout } = config;
    const connection = await mysql.createConnection({ host, port, user, password, socketPath, ssl, connectTimeout }).promise();
    try {
        return await collectPerformanceReport(connection, { ...options, database: options.database ?? config.database,
            snapshotOwner: JSON.stringify([host, port, user, socketPath]) });
    } catch (error) {
        if (['ER_TABLEACCESS_DENIED_ERROR', 'ER_DBACCESS_DENIED_ERROR', 'ER_NO_SUCH_TABLE', 'ER_BAD_FIELD_ERROR'].includes(error.code)) {
            throw new Error(`Performance statistics are unavailable. Check MySQL compatibility and SELECT access to Performance Schema. ${error.message}`);
        }
        throw error;
    } finally {
        await connection.end();
    }
}
