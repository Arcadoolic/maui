import {describe, it, expect, beforeEach, afterEach, vi} from 'vitest';
import {mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, statSync} from 'fs';
import {join} from 'path';
import {tmpdir} from 'os';
import Config from '@/class/Config.class';
import {encryptSecret, generateDataKey, isEncryptedSecret} from '@/class/SecretBox';

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

    it('drops the former starting-pack repository settings (the URL now comes from MAUI-API)', () => {
        new Config();
        writeFileSync(configPath, JSON.stringify({
            mamePath: '/opt/mame',
            mameBinaryName: 'mame',
            repoUrl: 'https://repo.maui.afronob.com',
            repoUser: 'admin',
            repoPassword: 'secret',
        }));

        const config = new Config();
        expect(config.load()).toBe(true);
        expect(config.mamePath).toBe('/opt/mame');
        config.save();

        const raw = JSON.parse(readFileSync(configPath, 'utf8'));
        expect(raw).not.toHaveProperty('repoUrl');
        expect(raw).not.toHaveProperty('repoUser');
        expect(raw).not.toHaveProperty('repoPassword');
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
        // Implementation: `configFile.openDevTools === true`, same convention as fullscreen
        // below. A missing key or any non-true value defaults to false.
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

    it('treats fullscreen as false (windowed) unless the file says exactly true', () => {
        // Implementation: `configFile.fullscreen === true`.
        const cases: Array<[unknown, boolean]> = [
            [undefined, false],
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

describe('Config uiMode and displayMode', () => {
    it('default to auto, also for a file without the key or with an unknown value', () => {
        expect(new Config().uiMode).toBe('auto');
        expect(new Config().displayMode).toBe('auto');
        for (const written of [undefined, 'turbo']) {
            const seed = new Config();
            seed.save();
            const raw = JSON.parse(readFileSync(configPath, 'utf8'));
            raw.uiMode = written;
            raw.displayMode = written;
            writeFileSync(configPath, JSON.stringify(raw));
            const config = new Config();
            config.load();
            expect(config.uiMode).toBe('auto');
            expect(config.displayMode).toBe('auto');
        }
    });
});

describe('Config boIdleMinutes', () => {
    it('defaults to 15 and only takes a whole number of minutes, 0 included', () => {
        expect(new Config().boIdleMinutes).toBe(15);
        for (const [written, expected] of [[0, 0], [60, 60], [-1, 15], [2.5, 15], ['30', 15], [undefined, 15]] as const) {
            const seed = new Config();
            seed.save();
            const raw = JSON.parse(readFileSync(configPath, 'utf8'));
            raw.boIdleMinutes = written;
            writeFileSync(configPath, JSON.stringify(raw));
            const config = new Config();
            config.load();
            expect(config.boIdleMinutes).toBe(expected);
        }
    });
});

describe('Config.save', () => {
    it('round-trips through load', () => {
        const written = new Config();
        written.mamePath = '/opt/mame';
        written.mameBinaryName = 'mame64';
        written.ssSoftName = 'mame-awesome-ui';
        written.bezelAspect = '4:3';
        written.openDevTools = true;
        written.fullscreen = true;
        written.uiMode = 'lite';
        written.displayMode = '720p';
        written.save();

        expect(existsSync(configPath)).toBe(true);

        const read = new Config();
        expect(read.load()).toBe(true);
        expect(read.mamePath).toBe('/opt/mame');
        expect(read.mameBinaryName).toBe('mame64');
        expect(read.ssSoftName).toBe('mame-awesome-ui');
        expect(read.bezelAspect).toBe('4:3');
        expect(read.openDevTools).toBe(true);
        expect(read.fullscreen).toBe(true);
        expect(read.uiMode).toBe('lite');
        expect(read.displayMode).toBe('720p');
    });

    it('writes only the documented keys, and never avatarsPath', () => {
        const config = new Config();
        config.mamePath = '/opt/mame';
        config.save();

        const raw = JSON.parse(readFileSync(configPath, 'utf8'));
        expect(Object.keys(raw).sort()).toEqual([
            'bezelAspect',
            'boIdleMinutes',
            'displayMode',
            'fullscreen',
            'mameBinaryName',
            'mamePath',
            'openDevTools',
            'showAllGamesCategory',
            'showBeatThisCategory',
            'showHiscoresOnlyCategory',
            'ssDevId',
            'ssDevPassword',
            'ssSoftName',
            'ssUserId',
            'ssUserPassword',
            'thumbsDownRemovesFavorite',
            'uiMode',
            'voteEnabled',
        ]);
    });

    it('turns the vote prompt and the thumbs down removal on by default, and reads them back', () => {
        const config = new Config();
        config.mamePath = '/opt/mame';
        expect(config.voteEnabled).toBe(true);
        expect(config.thumbsDownRemovesFavorite).toBe(true);

        config.voteEnabled = false;
        config.thumbsDownRemovesFavorite = false;
        config.save();
        const read = new Config();
        read.load();
        expect(read.voteEnabled).toBe(false);
        expect(read.thumbsDownRemovesFavorite).toBe(false);

        // A config file written before these settings existed keeps the defaults.
        writeFileSync(configPath, JSON.stringify({mamePath: '/opt/mame', mameBinaryName: 'mame'}));
        const legacy = new Config();
        legacy.load();
        expect(legacy.voteEnabled).toBe(true);
        expect(legacy.thumbsDownRemovesFavorite).toBe(true);
    });
});

describe('Config carousel categories', () => {
    it('shows the three categories by default, and reads back the ones switched off', () => {
        const config = new Config();
        config.mamePath = '/opt/mame';
        expect(config.showAllGamesCategory).toBe(true);
        expect(config.showBeatThisCategory).toBe(true);
        expect(config.showHiscoresOnlyCategory).toBe(true);

        config.showAllGamesCategory = false;
        config.showBeatThisCategory = false;
        config.showHiscoresOnlyCategory = false;
        config.save();
        const read = new Config();
        read.load();
        expect(read.showAllGamesCategory).toBe(false);
        expect(read.showBeatThisCategory).toBe(false);
        expect(read.showHiscoresOnlyCategory).toBe(false);

        // A config file written before these settings existed keeps the defaults.
        writeFileSync(configPath, JSON.stringify({mamePath: '/opt/mame', mameBinaryName: 'mame'}));
        const legacy = new Config();
        legacy.load();
        expect(legacy.showAllGamesCategory).toBe(true);
        expect(legacy.showBeatThisCategory).toBe(true);
        expect(legacy.showHiscoresOnlyCategory).toBe(true);
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

describe('Config secrets encryption', () => {
    const plaintextFile = {
        mamePath: '/mame', mameBinaryName: 'mame',
        ssDevId: 'dev', ssDevPassword: 'devpass', ssUserId: 'user', ssUserPassword: 'userpass',
    };

    it('writes the passwords encrypted with a data key, identifiers in the clear', () => {
        new Config().exist(); // creates the app data directory
        writeFileSync(configPath, JSON.stringify(plaintextFile));
        const dataKey = generateDataKey();

        const config = new Config(dataKey);
        config.load();
        expect(config.hasPlaintextSecrets()).toBe(true);
        config.save();

        const saved = JSON.parse(readFileSync(configPath, 'utf8'));
        expect(saved.ssDevId).toBe('dev');
        expect(saved.ssUserId).toBe('user');
        for (const field of ['ssDevPassword', 'ssUserPassword']) {
            expect(isEncryptedSecret(saved[field])).toBe(true);
        }

        const reloaded = new Config(dataKey);
        reloaded.load();
        expect(reloaded.hasPlaintextSecrets()).toBe(false);
        expect([reloaded.ssDevPassword, reloaded.ssUserPassword]).toEqual(['devpass', 'userpass']);
    });

    it('carries encrypted values untouched through a load/save without a data key', () => {
        new Config().exist();
        writeFileSync(configPath, JSON.stringify(plaintextFile));
        const encrypting = new Config(generateDataKey());
        encrypting.load();
        encrypting.save();
        const before = JSON.parse(readFileSync(configPath, 'utf8'));

        const config = new Config();
        config.load();
        config.fullscreen = true;
        config.save();

        const after = JSON.parse(readFileSync(configPath, 'utf8'));
        expect(after.ssDevPassword).toBe(before.ssDevPassword);
        expect(after.ssUserPassword).toBe(before.ssUserPassword);
    });

    it('reads a value encrypted with another key as unset', () => {
        new Config().exist();
        writeFileSync(configPath, JSON.stringify({
            ...plaintextFile, ssUserPassword: encryptSecret(generateDataKey(), 'other cabinet'),
        }));

        const config = new Config(generateDataKey());
        config.load();

        expect(config.ssUserPassword).toBe('');
    });

    it.skipIf(process.platform === 'win32')('writes the file owner-only, even one created wider', () => {
        new Config().exist();
        writeFileSync(configPath, JSON.stringify(plaintextFile), {mode: 0o644});

        const config = new Config();
        config.load();
        config.save();

        expect(statSync(configPath).mode & 0o777).toBe(0o600);
    });
});
