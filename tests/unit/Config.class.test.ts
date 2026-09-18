import {describe, it, expect, beforeEach, afterEach, vi} from 'vitest';
import {mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync} from 'fs';
import {join} from 'path';
import {tmpdir} from 'os';
import Config from '@/class/Config.class';

// Config.class.ts fixes its directory at os.homedir()/.mame-awesome-ui, with no
// NODE_ENV branching (refacto-2026 dropped the old dev-vs-production split, see
// Config.class.ts's own comment on getAppDataPath()). That means every `new
// Config()` writes into the real home directory as a side effect unless
// os.homedir is stubbed first, the same way Helpers.class.test.ts stubs it for
// Helpers.getMameHomePath. See that file's comment for why 'node:os' is the
// only spelling Vitest actually intercepts here.
const homedirOverride: {value: string | null} = {value: null};

vi.mock('node:os', async (importOriginal) => {
    const actual = await importOriginal<typeof import('os')>();
    return {
        ...actual,
        homedir: () => homedirOverride.value ?? actual.homedir(),
    };
});

let fakeHome: string;
let configPath: string;

beforeEach(() => {
    fakeHome = mkdtempSync(join(tmpdir(), 'mame-config-home-'));
    homedirOverride.value = fakeHome;
    configPath = join(fakeHome, '.mame-awesome-ui', 'mame-awesome-ui-config.json');
});

afterEach(() => {
    homedirOverride.value = null;
    rmSync(fakeHome, {recursive: true, force: true});
});

describe('Config construction', () => {
    it('fixes configPath under home/.mame-awesome-ui, regardless of NODE_ENV', () => {
        expect(new Config().configPath).toBe(configPath);
    });

    it('creates and exposes a computed avatarsPath, not loaded from the config file', () => {
        const config = new Config();
        const expected = join(fakeHome, '.mame-awesome-ui', 'avatars');

        expect(config.avatarsPath).toBe(expected);
        expect(existsSync(expected)).toBe(true);
    });
});

describe('Config.exist', () => {
    it('is false when no config file is present', () => {
        expect(new Config().exist()).toBe(false);
    });

    it('is true once the file exists', () => {
        new Config(); // creates .mame-awesome-ui, so the write below has somewhere to land
        writeFileSync(configPath, '{}');
        expect(new Config().exist()).toBe(true);
    });
});

describe('Config.load', () => {
    it('returns false and leaves the instance unloaded when there is no file', () => {
        const config = new Config();
        expect(config.load()).toBe(false);
        expect(config.loaded()).toBe(false);
    });

    it('reads the documented fields', () => {
        new Config();
        writeFileSync(configPath, JSON.stringify({
            mamePath: '/opt/mame',
            mameBinaryName: 'mame',
            ssDevId: 'dev',
            ssUserId: 'user',
            bezelAspect: '4:3',
        }));

        const config = new Config();
        expect(config.load()).toBe(true);
        expect(config.loaded()).toBe(true);
        expect(config.mamePath).toBe('/opt/mame');
        expect(config.mameBinaryName).toBe('mame');
        expect(config.ssDevId).toBe('dev');
        expect(config.ssUserId).toBe('user');
        expect(config.bezelAspect).toBe('4:3');
    });

    it('does not overwrite avatarsPath from the file, since it is computed, not loaded', () => {
        new Config();
        writeFileSync(configPath, JSON.stringify({
            mamePath: '/opt/mame',
            mameBinaryName: 'mame',
            avatarsPath: '/some/other/path',
        }));

        const config = new Config();
        config.load();
        expect(config.avatarsPath).toBe(join(fakeHome, '.mame-awesome-ui', 'avatars'));
    });

    it('defaults the ScreenScraper credentials to empty strings when absent', () => {
        new Config();
        writeFileSync(configPath, JSON.stringify({
            mamePath: '/opt/mame',
            mameBinaryName: 'mame',
        }));

        const config = new Config();
        config.load();
        expect(config.ssDevId).toBe('');
        expect(config.ssDevPassword).toBe('');
        expect(config.ssSoftName).toBe('');
        expect(config.ssUserPassword).toBe('');
    });

    it('reads the starting-pack repo credentials, defaulting to empty strings when absent', () => {
        new Config();
        writeFileSync(configPath, JSON.stringify({
            mamePath: '/opt/mame',
            mameBinaryName: 'mame',
            repoUrl: 'https://repo.maui.afronob.com',
            repoUser: 'admin',
            repoPassword: 'secret',
        }));

        const config = new Config();
        config.load();
        expect(config.repoUrl).toBe('https://repo.maui.afronob.com');
        expect(config.repoUser).toBe('admin');
        expect(config.repoPassword).toBe('secret');

        const withoutRepo = new Config();
        writeFileSync(configPath, JSON.stringify({mamePath: '/opt/mame', mameBinaryName: 'mame'}));
        withoutRepo.load();
        expect(withoutRepo.repoUrl).toBe('');
        expect(withoutRepo.repoUser).toBe('');
        expect(withoutRepo.repoPassword).toBe('');
    });

    it('defaults bezelAspect to 16:9 unless the file says exactly 4:3', () => {
        // Implementation: `configFile.bezelAspect === '4:3' ? '4:3' : '16:9'`.
        const cases: Array<[unknown, '4:3' | '16:9']> = [
            [undefined, '16:9'],
            ['4:3', '4:3'],
            ['16:9', '16:9'],
            ['garbage', '16:9'],
        ];

        for (const [written, expected] of cases) {
            new Config();
            writeFileSync(configPath, JSON.stringify({
                mamePath: '/opt/mame',
                mameBinaryName: 'mame',
                bezelAspect: written,
            }));
            const config = new Config();
            config.load();
            expect(config.bezelAspect).toBe(expected);
        }
    });

    it('treats openDevTools as true only when the file says exactly true', () => {
        // Implementation: `configFile.openDevTools === true`, the inverse convention of
        // fullscreen below. A missing key or any non-true value defaults to false.
        const cases: Array<[unknown, boolean]> = [
            [undefined, false],
            [false, false],
            [true, true],
            [1, false],
        ];

        for (const [written, expected] of cases) {
            new Config();
            writeFileSync(configPath, JSON.stringify({
                mamePath: '/opt/mame',
                mameBinaryName: 'mame',
                openDevTools: written,
            }));
            const config = new Config();
            config.load();
            expect(config.openDevTools).toBe(expected);
        }
    });

    it('treats fullscreen as true unless the file says exactly false', () => {
        // Implementation: `configFile.fullscreen !== false`.
        const cases: Array<[unknown, boolean]> = [
            [undefined, true],
            [true, true],
            [false, false],
        ];

        for (const [written, expected] of cases) {
            new Config();
            writeFileSync(configPath, JSON.stringify({
                mamePath: '/opt/mame',
                mameBinaryName: 'mame',
                fullscreen: written,
            }));
            const config = new Config();
            config.load();
            expect(config.fullscreen).toBe(expected);
        }
    });
});

describe('Config.save', () => {
    it('round-trips through load', () => {
        const written = new Config();
        written.mamePath = '/opt/mame';
        written.mameBinaryName = 'mame64';
        written.ssSoftName = 'mame-awesome-ui';
        written.repoUrl = 'https://repo.maui.afronob.com';
        written.repoUser = 'admin';
        written.repoPassword = 'secret';
        written.bezelAspect = '4:3';
        written.openDevTools = true;
        written.fullscreen = false;
        written.save();

        expect(existsSync(configPath)).toBe(true);

        const read = new Config();
        expect(read.load()).toBe(true);
        expect(read.mamePath).toBe('/opt/mame');
        expect(read.mameBinaryName).toBe('mame64');
        expect(read.ssSoftName).toBe('mame-awesome-ui');
        expect(read.repoUrl).toBe('https://repo.maui.afronob.com');
        expect(read.repoUser).toBe('admin');
        expect(read.repoPassword).toBe('secret');
        expect(read.bezelAspect).toBe('4:3');
        expect(read.openDevTools).toBe(true);
        expect(read.fullscreen).toBe(false);
    });

    it('writes only the documented keys, and never avatarsPath', () => {
        const config = new Config();
        config.mamePath = '/opt/mame';
        config.save();

        const raw = JSON.parse(readFileSync(configPath, 'utf8'));
        expect(Object.keys(raw).sort()).toEqual([
            'bezelAspect',
            'fullscreen',
            'mameBinaryName',
            'mamePath',
            'openDevTools',
            'repoPassword',
            'repoUrl',
            'repoUser',
            'ssDevId',
            'ssDevPassword',
            'ssSoftName',
            'ssUserId',
            'ssUserPassword',
        ]);
    });
});

describe('Config.delete', () => {
    it('removes the config file and marks the instance unloaded', () => {
        const config = new Config();
        config.mamePath = '/opt/mame';
        config.save();
        config.load();
        expect(config.loaded()).toBe(true);

        config.delete();

        expect(existsSync(configPath)).toBe(false);
        expect(config.loaded()).toBe(false);
    });

    it('does not throw when there is no file to delete', () => {
        const config = new Config();
        expect(() => config.delete()).not.toThrow();
    });
});
