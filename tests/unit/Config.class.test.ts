import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync} from 'fs';
import {join} from 'path';
import {tmpdir} from 'os';
import Config from '@/class/Config.class';

// Config picks its directory from NODE_ENV: '.' in development, the passed
// userDataPath otherwise. These tests run in the non-development branch so the
// temp directory is actually used.
const originalNodeEnv = process.env.NODE_ENV;
let dir: string;

beforeEach(() => {
    process.env.NODE_ENV = 'test';
    dir = mkdtempSync(join(tmpdir(), 'mame-config-'));
});

afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
    rmSync(dir, {recursive: true, force: true});
});

describe('Config.exist', () => {
    it('is false when no config file is present', () => {
        expect(new Config(dir).exist()).toBe(false);
    });

    it('is true once the file exists', () => {
        writeFileSync(join(dir, 'mame-awesome-ui-config.json'), '{}');
        expect(new Config(dir).exist()).toBe(true);
    });
});

describe('Config.load', () => {
    it('returns false and leaves the instance unloaded when there is no file', () => {
        const config = new Config(dir);
        expect(config.load()).toBe(false);
        expect(config.loaded()).toBe(false);
    });

    it('reads the documented fields', () => {
        writeFileSync(join(dir, 'mame-awesome-ui-config.json'), JSON.stringify({
            mamePath: '/opt/mame',
            mameBinaryName: 'mame',
            avatarsPath: '/opt/avatars',
            ssDevId: 'dev',
            ssUserId: 'user',
        }));

        const config = new Config(dir);
        expect(config.load()).toBe(true);
        expect(config.loaded()).toBe(true);
        expect(config.mamePath).toBe('/opt/mame');
        expect(config.mameBinaryName).toBe('mame');
        expect(config.avatarsPath).toBe('/opt/avatars');
        expect(config.ssDevId).toBe('dev');
        expect(config.ssUserId).toBe('user');
    });

    it('defaults the ScreenScraper credentials to empty strings when absent', () => {
        writeFileSync(join(dir, 'mame-awesome-ui-config.json'), JSON.stringify({
            mamePath: '/opt/mame',
            mameBinaryName: 'mame',
            avatarsPath: '/opt/avatars',
        }));

        const config = new Config(dir);
        config.load();
        expect(config.ssDevId).toBe('');
        expect(config.ssDevPassword).toBe('');
        expect(config.ssSoftName).toBe('');
        expect(config.ssUserPassword).toBe('');
    });

    it('treats openDevTools as true unless it is exactly false', () => {
        // The implementation is `configFile.openDevTools !== false`, so a missing
        // key and any truthy or non-false value all yield true.
        const cases: Array<[unknown, boolean]> = [
            [undefined, true],
            [true, true],
            [false, false],
        ];

        for (const [written, expected] of cases) {
            writeFileSync(join(dir, 'mame-awesome-ui-config.json'), JSON.stringify({
                mamePath: '/opt/mame',
                mameBinaryName: 'mame',
                avatarsPath: '/opt/avatars',
                openDevTools: written,
            }));
            const config = new Config(dir);
            config.load();
            expect(config.openDevTools).toBe(expected);
        }
    });
});

describe('Config.save', () => {
    it('round-trips through load', () => {
        const written = new Config(dir);
        written.mamePath = '/opt/mame';
        written.mameBinaryName = 'mame64';
        written.avatarsPath = '/opt/avatars';
        written.ssSoftName = 'mame-awesome-ui';
        written.openDevTools = false;
        written.save();

        expect(existsSync(join(dir, 'mame-awesome-ui-config.json'))).toBe(true);

        const read = new Config(dir);
        expect(read.load()).toBe(true);
        expect(read.mamePath).toBe('/opt/mame');
        expect(read.mameBinaryName).toBe('mame64');
        expect(read.avatarsPath).toBe('/opt/avatars');
        expect(read.ssSoftName).toBe('mame-awesome-ui');
        expect(read.openDevTools).toBe(false);
    });

    it('writes only the documented keys', () => {
        const config = new Config(dir);
        config.mamePath = '/opt/mame';
        config.save();

        const raw = JSON.parse(readFileSync(join(dir, 'mame-awesome-ui-config.json'), 'utf8'));
        expect(Object.keys(raw).sort()).toEqual([
            'avatarsPath',
            'mameBinaryName',
            'mamePath',
            'openDevTools',
            'ssDevId',
            'ssDevPassword',
            'ssSoftName',
            'ssUserId',
            'ssUserPassword',
        ]);
    });
});
