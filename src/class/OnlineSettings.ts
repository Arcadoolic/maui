import {existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync} from 'fs';
import {randomUUID} from 'crypto';
import {dirname, join} from 'path';
import * as os from 'os';

// ONLINE credentials live in their own owner-only file, not in mame-awesome-ui-config.json: the
// BO export/import (/maui/export, /maui/import) copies that config file around, and copying the
// token to another cabinet would leak it. localUuid is half of the machine fingerprint (see
// MachineFingerprint.ts): regenerating it makes the API see a new machine, hence the corrupt-file
// error below instead of a silent reset.

export interface OnlineSettings {
    url: string;
    key: string;
    token: string;
    localUuid: string;
    enabled: boolean;
}

const DEFAULTS: OnlineSettings = {url: '', key: '', token: '', localUuid: '', enabled: false};
const FILE_MODE = 0o600;

export class OnlineSettingsError extends Error {
    public constructor(path: string) {
        super(`Unreadable ONLINE settings file: ${path}`);
        this.name = 'OnlineSettingsError';
    }
}

export function getOnlineSettingsPath(): string {
    return join(os.homedir(), '.mame-awesome-ui', 'online.json');
}

function stringOr(value: unknown, fallback: string): string {
    return typeof value === 'string' ? value : fallback;
}

export function readOnlineSettings(path: string = getOnlineSettingsPath()): OnlineSettings {
    if (!existsSync(path)) {
        return {...DEFAULTS};
    }

    let data: unknown;
    try {
        data = JSON.parse(readFileSync(path, 'utf8'));
    } catch {
        throw new OnlineSettingsError(path);
    }
    if (typeof data !== 'object' || data === null || Array.isArray(data)) {
        throw new OnlineSettingsError(path);
    }

    const raw = data as Record<string, unknown>;
    return {
        url: stringOr(raw.url, DEFAULTS.url),
        key: stringOr(raw.key, DEFAULTS.key),
        token: stringOr(raw.token, DEFAULTS.token),
        localUuid: stringOr(raw.localUuid, DEFAULTS.localUuid),
        enabled: typeof raw.enabled === 'boolean' ? raw.enabled : DEFAULTS.enabled,
    };
}

export function writeOnlineSettings(settings: OnlineSettings, path: string = getOnlineSettingsPath()): void {
    mkdirSync(dirname(path), {recursive: true});
    // Temp file + rename: a crash mid-write never leaves a truncated file (and a lost localUuid),
    // and the replacement is created 0600 even if the previous file had looser permissions.
    const tempPath = `${path}.${process.pid}.tmp`;
    try {
        writeFileSync(tempPath, JSON.stringify(settings, null, 4), {mode: FILE_MODE});
        renameSync(tempPath, path);
    } catch (error) {
        rmSync(tempPath, {force: true});
        throw error;
    }
}

export function ensureLocalUuid(path: string = getOnlineSettingsPath()): OnlineSettings {
    const settings = readOnlineSettings(path);
    if (settings.localUuid !== '') {
        return settings;
    }
    const withUuid = {...settings, localUuid: randomUUID()};
    writeOnlineSettings(withUuid, path);
    return withUuid;
}
