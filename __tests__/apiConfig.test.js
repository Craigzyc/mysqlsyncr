import { setConfig } from '../src/socketServer';

test('explicit empty credentials are not silently replaced by startup credentials', () => {
    const input = { host: 'new-host', password: '', user: '' };
    expect(setConfig(input, { host: 'old-host', password: 'old-password', user: 'root', port: 3307 })).toEqual({ ...input, port: 3307 });
    expect(input).toEqual({ host: 'new-host', password: '', user: '' });
});
test('omitted config gets defaults, invalid config is rejected', () => {
    expect(setConfig(undefined, { host: 'localhost' }).host).toBe('localhost');
    for (const invalid of [null, [], 'host']) expect(() => setConfig(invalid)).toThrow('config must be an object');
});
