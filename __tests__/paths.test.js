import path from 'path';
import { packageRoot, isInsidePackage, assertOutsidePackage } from '../src/paths';

describe('package folder check', () => {
    test('finds the package root', () => {
        expect(path.basename(path.join(packageRoot, 'package.json'))).toBe('package.json');
        expect(require(path.join(packageRoot, 'package.json')).name).toBe('mysqlsyncr');
    });

    test('the package folder and anything under it are inside', () => {
        expect(isInsidePackage(packageRoot)).toBe(true);
        expect(isInsidePackage(path.join(packageRoot, 'db-dump'))).toBe(true);
        expect(() => assertOutsidePackage(path.join(packageRoot, 'src', 'x'))).toThrow('inside the mysqlsyncr package folder');
    });

    test('sibling and parent folders are outside', () => {
        expect(isInsidePackage(path.join(packageRoot, '..', 'db-dump'))).toBe(false);
        expect(isInsidePackage(packageRoot + '-dumps')).toBe(false);
        expect(isInsidePackage(path.dirname(packageRoot))).toBe(false);
    });
});
