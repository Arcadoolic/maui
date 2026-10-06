import {describe, it, expect, beforeEach, afterEach, vi} from 'vitest';
import {mkdtempSync, rmSync, writeFileSync} from 'fs';
import {join} from 'path';
import {tmpdir} from 'os';
import {createOnlineClient} from '@/class/OnlineClient';
import {writeOnlineSettings} from '@/class/OnlineSettings';

const configured = {url: 'https://api.example.org', key: 'mk_k', token: '1|t', localUuid: '0b7c2f1e-5a3d-4c8e-9f10-2a3b4c5d6e7f', enabled: true};
const machineIdSources = {readFile: async () => 'os-id', execFile: async () => ''};

let dir: string;
let path: string;

beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'maui-online-client-'));
    path = join(dir, 'online.json');
});

afterEach(() => rmSync(dir, {recursive: true, force: true}));

describe('createOnlineClient', () => {
    it('returns a client calling the configured API', async () => {
        writeOnlineSettings(configured, path);
        const fetchImpl = vi.fn(async () => new Response(JSON.stringify({players: []}), {status: 200}));

        const client = await createOnlineClient({settingsPath: path, machineIdSources, platform: 'linux', fetchImpl: fetchImpl as unknown as typeof fetch});

        expect(await client?.listPlayers()).toEqual({kind: 'ok', value: []});
        expect((fetchImpl.mock.calls[0] as unknown[])[0]).toBe('https://api.example.org/api/v1/players');
    });

    it('returns null while ONLINE is off, not configured or unreadable', async () => {
        writeOnlineSettings({...configured, enabled: false}, path);
        expect(await createOnlineClient({settingsPath: path, machineIdSources})).toBeNull();

        writeOnlineSettings({...configured, token: ''}, path);
        expect(await createOnlineClient({settingsPath: path, machineIdSources})).toBeNull();

        writeFileSync(path, '{not json');
        expect(await createOnlineClient({settingsPath: path, machineIdSources})).toBeNull();
    });

    it('returns a client for a configured ONLINE turned off when asked to', async () => {
        writeOnlineSettings({...configured, enabled: false}, path);
        expect(await createOnlineClient({settingsPath: path, machineIdSources, requireEnabled: false})).not.toBeNull();

        writeOnlineSettings({...configured, enabled: false, token: ''}, path);
        expect(await createOnlineClient({settingsPath: path, machineIdSources, requireEnabled: false})).toBeNull();
    });
});
