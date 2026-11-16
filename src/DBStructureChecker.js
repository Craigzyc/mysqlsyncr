import mysql from 'mysql2';
import util from 'util';
import { dumpAllDatabases } from './dump.js';
import { compareAllDatabases } from './compare.js';
import { getDatabases } from './getters.js';

// The config also carries mysqlsyncr's own settings (the template folder); mysql2
// warns about options it doesn't know, so pass it only the connection's
const connectionOptions = (config) => {
    const options = { ...config };
    // Schema selection belongs to the operation. Selecting it in the handshake
    // prevents compare/update from discovering and restoring a missing schema.
    for (const key of ['database', 'output', 'uiPort', 'uiHost', 'openUI', 'verbose', 'write',
        'slowMs', 'minExecutions', 'minRowsExamined', 'scanRatio', 'limit', 'json', 'baselineId']) delete options[key];
    return options;
}

const closedError = () => Object.assign(new Error('Database connection is closed or closing.'), { code: 'MYSQLSYNCR_CONNECTION_CLOSED' });

const waitForConnection = state => {
    if (state.error) return Promise.reject(state.error);
    if (state.closed || state.closing || state.connection.state === 'disconnected') return Promise.reject(closedError());
    return new Promise((resolve, reject) => {
        state.connection.connect(error => {
            if (error || state.error) reject(error || state.error);
            else if (state.closed || state.closing) reject(closedError());
            else resolve(state.connection);
        });
    });
};

export class DBStructureChecker {
    constructor(config = {}, targetDatabase = null) {
        this.config = config;
        this.targetDatabase = targetDatabase ?? config?.database ?? null;
        this.dumpAllDatabases = dumpAllDatabases;
        this.compareAllDatabases = compareAllDatabases;
        this.getDatabases = () => getDatabases(this.connection);
        this._openConnection();
    }

    _openConnection() {
        const connection = mysql.createConnection(connectionOptions(this.config));
        const state = { connection, error: null, closed: false, closing: null };
        this._state = state;
        this.connection = connection;
        // Retain errors for ready/query callers even if they arrive between
        // operations. Existing error/connect listeners still receive the events.
        // There is no eagerly rejected promise for legacy event-only callers.
        connection.on('error', error => { state.error = error; });
        connection.once('end', () => { state.closed = true; });
        const query = util.promisify(connection.query.bind(connection));
        connection.query = async (...args) => {
            await waitForConnection(state);
            if (state.error) throw state.error;
            if (state.closed || state.closing) throw closedError();
            return query(...args);
        };
    }

    ready() {
        return waitForConnection(this._state);
    }

    connect() {
        return this.ready();
    }

    reconnect() {
        if (this._reconnecting) return this._reconnecting;
        this._reconnecting = (async () => {
            await this.closeConnection();
            this._openConnection();
            return this.ready();
        })().finally(() => { this._reconnecting = null; });
        return this._reconnecting;
    }

    async closeConnection() {
        const state = this._state;
        if (state.closed) return;
        if (state.closing) return state.closing;
        if (state.error || state.connection.state === 'disconnected') {
            // A failed handshake/socket cannot accept a queued QUIT command.
            state.connection.destroy();
            state.closed = true;
            return;
        }
        state.closing = new Promise((resolve, reject) => {
            const finish = error => {
                state.closed = true;
                if (error) {
                    state.connection.destroy();
                    reject(error);
                } else resolve();
            };
            try { state.connection.end(finish); }
            catch (error) { finish(error); }
        });
        return state.closing;
    }
}
