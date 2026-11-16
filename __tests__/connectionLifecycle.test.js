import { EventEmitter } from 'node:events';
import mysql from 'mysql2';
import { DBStructureChecker } from '../src/DBStructureChecker';

jest.mock('mysql2', () => ({ createConnection: jest.fn() }));

function nativeConnection(rows = [{ value: 42 }]) {
    const connection = new EventEmitter();
    connection.state = 'connecting';
    connection.connect = jest.fn(callback => {
        if (!callback) return;
        if (connection.state === 'authenticated') return callback(null, connection);
        const onConnect = () => { connection.removeListener('error', onError); callback(null, connection); };
        const onError = error => { connection.removeListener('connect', onConnect); callback(error); };
        connection.once('connect', onConnect);
        connection.once('error', onError);
    });
    connection.query = jest.fn(function (...args) {
        if (this !== connection) throw new Error('Native query lost its connection binding');
        const callback = args.pop();
        callback(null, rows, [{ name: 'value' }]);
    });
    connection.end = jest.fn(callback => { connection.finishEnd = callback; });
    connection.destroy = jest.fn(() => { connection.state = 'disconnected'; });
    connection.succeed = () => { connection.state = 'authenticated'; connection.emit('connect'); };
    return connection;
}

beforeEach(() => mysql.createConnection.mockReset());

test('keeps schema scope without selecting a database before it can be restored', () => {
    mysql.createConnection.mockReturnValue(nativeConnection());
    const ssl = { rejectUnauthorized: true };
    const checker = new DBStructureChecker({ host: 'localhost', database: 'missing_schema', output: '/template', uiPort: 3600, verbose: true, ssl });
    expect(checker.targetDatabase).toBe('missing_schema');
    expect(mysql.createConnection).toHaveBeenCalledWith({ host: 'localhost', ssl });
});

test('ready and connect wait for authentication while preserving legacy connect events', async () => {
    const connection = nativeConnection();
    mysql.createConnection.mockReturnValue(connection);
    const checker = new DBStructureChecker({});
    const listener = jest.fn();
    checker.connection.on('connect', listener);
    let completed = false;
    const ready = checker.ready().then(result => { completed = true; return result; });
    await Promise.resolve();
    expect(completed).toBe(false);
    connection.succeed();
    await expect(ready).resolves.toBe(connection);
    await expect(checker.connect()).resolves.toBe(connection);
    expect(listener).toHaveBeenCalledTimes(1);
});

test('queries wait for readiness, preserve parameters and return rows without mysql2 fields', async () => {
    const connection = nativeConnection();
    const nativeQuery = connection.query;
    mysql.createConnection.mockReturnValue(connection);
    const checker = new DBStructureChecker({});
    const query = checker.connection.query('SELECT ?', [42]);
    expect(nativeQuery).not.toHaveBeenCalled();
    connection.succeed();
    await expect(query).resolves.toEqual([{ value: 42 }]);
    expect(nativeQuery).toHaveBeenCalledWith('SELECT ?', [42], expect.any(Function));
});

test('getDatabases queries live metadata rather than a nonexistent __dirname file', async () => {
    const connection = nativeConnection([{ Database: 'mysql' }, { Database: 'app' }, { Database: 'information_schema' }]);
    mysql.createConnection.mockReturnValue(connection);
    const checker = new DBStructureChecker({});
    connection.succeed();
    await expect(checker.getDatabases()).resolves.toEqual(['app']);
});

test('closeConnection awaits the end callback and is idempotent, including concurrent closes', async () => {
    const connection = nativeConnection();
    mysql.createConnection.mockReturnValue(connection);
    const checker = new DBStructureChecker({});
    connection.succeed();
    let closed = false;
    const first = checker.closeConnection().then(() => { closed = true; });
    const second = checker.closeConnection();
    await Promise.resolve();
    expect(closed).toBe(false);
    expect(connection.end).toHaveBeenCalledTimes(1);
    connection.finishEnd();
    await Promise.all([first, second]);
    await checker.closeConnection();
    expect(connection.end).toHaveBeenCalledTimes(1);
    await expect(checker.ready()).rejects.toThrow(/closed|closing/i);
});

test('reconnect closes the old session before opening and awaiting the new session', async () => {
    const first = nativeConnection(), second = nativeConnection();
    mysql.createConnection.mockReturnValueOnce(first).mockReturnValueOnce(second);
    const checker = new DBStructureChecker({});
    first.succeed();
    let ready = false;
    const reconnect = checker.reconnect().then(() => { ready = true; });
    await Promise.resolve();
    expect(first.end).toHaveBeenCalledTimes(1);
    expect(mysql.createConnection).toHaveBeenCalledTimes(1);
    first.finishEnd();
    await new Promise(resolve => setImmediate(resolve));
    expect(mysql.createConnection).toHaveBeenCalledTimes(2);
    expect(ready).toBe(false);
    second.succeed();
    await reconnect;
    expect(checker.connection).toBe(second);
    await expect(checker.connection.query('SELECT 42')).resolves.toEqual([{ value: 42 }]);
});

test('initial and later connection errors reach ready/query callers and legacy error listeners', async () => {
    const connection = nativeConnection();
    mysql.createConnection.mockReturnValue(connection);
    const checker = new DBStructureChecker({});
    const listener = jest.fn();
    connection.on('error', listener);
    const ready = checker.ready();
    const denied = Object.assign(new Error('Access denied'), { code: 'ER_ACCESS_DENIED_ERROR' });
    connection.emit('error', denied);
    await expect(ready).rejects.toBe(denied);
    await expect(checker.connection.query('SELECT 1')).rejects.toBe(denied);
    expect(listener).toHaveBeenCalledWith(denied);
    await checker.closeConnection();
    expect(connection.destroy).toHaveBeenCalledTimes(1);
});

test('an idle network failure is not an unhandled EventEmitter error or a healthy ready session', async () => {
    const connection = nativeConnection();
    mysql.createConnection.mockReturnValue(connection);
    const checker = new DBStructureChecker({});
    connection.succeed();
    const lost = Object.assign(new Error('Connection lost'), { code: 'PROTOCOL_CONNECTION_LOST' });
    expect(() => connection.emit('error', lost)).not.toThrow();
    await expect(checker.ready()).rejects.toBe(lost);
    await expect(checker.connection.query('SELECT 1')).rejects.toBe(lost);
});

test('a native connection destroyed by the caller cannot become ready again', async () => {
    const connection = nativeConnection();
    mysql.createConnection.mockReturnValue(connection);
    const checker = new DBStructureChecker({});
    connection.succeed();
    connection.destroy();
    await expect(checker.ready()).rejects.toThrow(/closed|closing/i);
});

test('a failure ending a session rejects closeConnection and destroys the failed socket', async () => {
    const connection = nativeConnection();
    mysql.createConnection.mockReturnValue(connection);
    const checker = new DBStructureChecker({});
    connection.succeed();
    const close = checker.closeConnection();
    const error = new Error('Quit failed');
    connection.finishEnd(error);
    await expect(close).rejects.toBe(error);
    expect(connection.destroy).toHaveBeenCalledTimes(1);
});

test('a destroyed session can reconnect after its first close reported a failure', async () => {
    const first = nativeConnection(), second = nativeConnection();
    mysql.createConnection.mockReturnValueOnce(first).mockReturnValueOnce(second);
    const checker = new DBStructureChecker({});
    first.succeed();
    const close = checker.closeConnection();
    first.finishEnd(new Error('Quit failed'));
    await expect(close).rejects.toThrow('Quit failed');
    await expect(checker.closeConnection()).resolves.toBeUndefined();
    const reconnect = checker.reconnect();
    await new Promise(resolve => setImmediate(resolve));
    second.succeed();
    await expect(reconnect).resolves.toBe(second);
});
