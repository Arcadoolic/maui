import {describe, it, expect, beforeEach, afterEach, vi} from 'vitest';
import {chmodSync, mkdtempSync, rmSync, writeFileSync, readFileSync, statSync, readdirSync} from 'fs';
import {join} from 'path';
import {tmpdir} from 'os';
import {
    OnlineSettingsError,
    ensureLocalUuid,
    getOnlineSettingsPath,
    readOnlineSettings,
    writeOnlineSettings,
} from '@/class/OnlineSettings';

// See Helpers.class.test.ts for why 'node:os' is the only spelling Vitest intercepts.
const homedirOverride: {value: string | null} = {value: null};

vi.mock('node:os', async (importOriginal) => {
    const actual = await importOriginal<typeof import('os')>();
    return {
        ...actual,
        homedir: () => homedirOverride.value ?? actual.homedir(),
    };
});

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const saved = {
    url: 'https://api.example.org',
    key: 'mk_7F3aQ9dLx2PzK8wR4mT6vYb1',
    token: '12|secret',
    localUuid: '0b7c2f1e-5a3d-4c8e-9f10-2a3b4c5d6e7f',
    enabled: true,
};

let dir: string;
let path: string;

beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'maui-online-'));
    path = join(dir, 'app', 'online.json');
});

afterEach(() => {
    homedirOverride.value = null;
    rmSync(dir, {recursive: true, force: true});
});

describe('getOnlineSettingsPath', () => {
    it('lives next to the main config, in its own file', () => {
        homedirOverride.value = dir;
        expect(getOnlineSettingsPath()).toBe(join(dir, '.mame-awesome-ui', 'online.json'));
    });
});

describe('readOnlineSettings', () => {
    it('returns disabled, empty settings when the file does not exist', () => {
        expect(readOnlineSettings(path)).toEqual({url: '', key: '', token: '', localUuid: '', enabled: false});
    });

    it('reads a saved file', () => {
        writeOnlineSettings(saved, path);
        expect(readOnlineSettings(path)).toEqual(saved);
    });

    it('falls back to defaults field by field when a value has the wrong type', () => {
        writeOnlineSettings(saved, path);
        writeFileSync(path, JSON.stringify({...saved, token: 42, enabled: 'yes'}));
        expect(readOnlineSettings(path)).toEqual({...saved, token: '', enabled: false});
    });

    it('drops unknown fields', () => {
        writeOnlineSettings(saved, path);
        writeFileSync(path, JSON.stringify({...saved, extra: 'x'}));
        expect(readOnlineSettings(path)).toEqual(saved);
    });

    it('throws instead of silently resetting the identity when the file is corrupt', () => {
        writeOnlineSettings(saved, path);
        writeFileSync(path, '{not json');
        expect(() => readOnlineSettings(path)).toThrow(OnlineSettingsError);
        writeFileSync(path, '[]');
        expect(() => readOnlineSettings(path)).toThrow(OnlineSettingsError);
    });
});

describe('writeOnlineSettings', () => {
    it('creates the directory and writes JSON', () => {
        writeOnlineSettings(saved, path);
        expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual(saved);
    });

    it.skipIf(process.platform === 'win32')('restricts the file to its owner', () => {
        writeOnlineSettings(saved, path);
        expect(statSync(path).mode & 0o777).toBe(0o600);
    });

    it.skipIf(process.platform === 'win32')('tightens the mode of a file created with looser permissions', () => {
        writeOnlineSettings(saved, path);
        chmodSync(path, 0o644);
        writeOnlineSettings(saved, path);
        expect(statSync(path).mode & 0o777).toBe(0o600);
    });

    it('leaves no temporary file behind', () => {
        writeOnlineSettings(saved, path);
        writeOnlineSettings({...saved, enabled: false}, path);
        expect(readdirSync(join(dir, 'app'))).toEqual(['online.json']);
    });
});

describe('ensureLocalUuid', () => {
    it('generates a v4 UUID on first use and persists it', () => {
        const settings = ensureLocalUuid(path);
        expect(settings.localUuid).toMatch(UUID_PATTERN);
        expect(readOnlineSettings(path).localUuid).toBe(settings.localUuid);
    });

    it('never regenerates an existing one', () => {
        writeOnlineSettings(saved, path);
        expect(ensureLocalUuid(path)).toEqual(saved);
        expect(ensureLocalUuid(path).localUuid).toBe(saved.localUuid);
    });

    it('keeps the other settings when it adds the UUID', () => {
        writeOnlineSettings({...saved, localUuid: ''}, path);
        const settings = ensureLocalUuid(path);
        expect(settings).toEqual({...saved, localUuid: settings.localUuid});
        expect(settings.localUuid).toMatch(UUID_PATTERN);
    });

    it('does not write when the UUID already exists', () => {
        writeOnlineSettings(saved, path);
        const before = statSync(path).mtimeMs;
        ensureLocalUuid(path);
        expect(statSync(path).mtimeMs).toBe(before);
    });
});
