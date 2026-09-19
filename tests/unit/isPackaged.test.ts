import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {mkdtempSync, rmSync, writeFileSync} from 'fs';
import {join} from 'path';
import {tmpdir} from 'os';
import {isPackaged} from '@/isPackaged';

describe('isPackaged', () => {
    const originalResourcesPath = process.resourcesPath;
    const originalNodeEnv = process.env.NODE_ENV;
    let dir: string;
    const setResourcesPath = (value: string | undefined) => {
        (process as {resourcesPath?: string}).resourcesPath = value;
    };

    beforeEach(() => {
        dir = mkdtempSync(join(tmpdir(), 'maui-ispackaged-'));
        setResourcesPath(dir);
    });

    afterEach(() => {
        setResourcesPath(originalResourcesPath);
        process.env.NODE_ENV = originalNodeEnv;
        rmSync(dir, {recursive: true, force: true});
    });

    it('is true when resourcesPath holds an app.asar, whatever NODE_ENV says', () => {
        writeFileSync(join(dir, 'app.asar'), '');
        process.env.NODE_ENV = 'development';
        expect(isPackaged()).toBe(true);
    });

    it('is false when resourcesPath only holds Electron\'s default_app.asar (dev)', () => {
        writeFileSync(join(dir, 'default_app.asar'), '');
        expect(isPackaged()).toBe(false);
    });

    it('is false when process.resourcesPath is undefined (plain Node)', () => {
        setResourcesPath(undefined);
        expect(isPackaged()).toBe(false);
    });
});
