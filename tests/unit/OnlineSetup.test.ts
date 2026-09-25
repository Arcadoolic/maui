import {describe, it, expect, beforeEach, afterEach, vi} from 'vitest';
import {mkdtempSync, rmSync, writeFileSync, mkdirSync} from 'fs';
import {join, dirname} from 'path';
import {tmpdir} from 'os';
import {
    describeRejection,
    describeOnlineStatus,
    getOnlineView,
    resetOnlineSettings,
    saveConfigurationString,
    setOnlineEnabled,
    testConnection,
} from '@/class/OnlineSetup';
import type {OnlineStatus} from '@/class/OnlineSession';
import {readOnlineSettings, writeOnlineSettings} from '@/class/OnlineSettings';
import {computeMachineFingerprint, type MachineIdSources} from '@/class/MachineFingerprint';

const configuration = {url: 'https://api.example.org', key: 'mk_7F3aQ9dLx2PzK8wR4mT6vYb1', token: '12|secret'};

function encode(payload: unknown): string {
    return 'MAUI1.' + Buffer.from(JSON.stringify(payload)).toString('base64url');
}

const machineIdSources: MachineIdSources = {
    readFile: async () => 'os-machine-id\n',
    execFile: async () => '',
};

let dir: string;
let path: string;

beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'maui-online-setup-'));
    path = join(dir, 'online.json');
});

afterEach(() => {
    rmSync(dir, {recursive: true, force: true});
});

function corruptFile(): void {
    mkdirSync(dirname(path), {recursive: true});
    writeFileSync(path, '{not json');
}

describe('getOnlineView', () => {
    it('is unconfigured without a settings file', () => {
        expect(getOnlineView(path)).toEqual({state: 'unconfigured'});
    });

    it('exposes the url and the key, never the token', () => {
        saveConfigurationString(encode(configuration), path);
        const view = getOnlineView(path);
        expect(view).toEqual({state: 'configured', url: configuration.url, key: configuration.key, enabled: false});
        expect(JSON.stringify(view)).not.toContain('secret');
    });

    it('reports a corrupt settings file instead of throwing', () => {
        corruptFile();
        const view = getOnlineView(path);
        expect(view.state).toBe('unreadable');
    });
});

describe('saveConfigurationString', () => {
    it('stores url, key and token from a valid string', () => {
        expect(saveConfigurationString(encode(configuration), path)).toEqual({ok: true});
        expect(readOnlineSettings(path)).toMatchObject(configuration);
    });

    it('keeps localUuid and the ONLINE switch when credentials are replaced', () => {
        writeOnlineSettings({url: 'https://old.example', key: 'mk_old', token: '1|old', localUuid: 'uuid-1', enabled: true}, path);
        saveConfigurationString(encode(configuration), path);
        expect(readOnlineSettings(path)).toEqual({...configuration, localUuid: 'uuid-1', enabled: true});
    });

    it('explains an invalid string and writes nothing', () => {
        const outcome = saveConfigurationString('MAUI2.abc', path);
        expect(outcome).toEqual({ok: false, error: expect.stringMatching(/update MAUI/)});
        expect(getOnlineView(path)).toEqual({state: 'unconfigured'});
    });

    it('refuses an empty paste', () => {
        expect(saveConfigurationString('   ', path)).toEqual({ok: false, error: expect.any(String)});
    });

    it('does not overwrite a corrupt settings file, which would lose localUuid', () => {
        corruptFile();
        expect(saveConfigurationString(encode(configuration), path)).toEqual({ok: false, error: expect.stringMatching(/online\.json/)});
    });
});

describe('testConnection', () => {
    const pingBody = {
        client: {key: configuration.key, name: 'marvelous_mario'},
        machine: {bound_at: '2026-09-25T10:00:00Z', newly_bound: true},
        server_time: '2026-09-25T10:00:00Z',
    };

    function fakeFetch(response: Response | Error) {
        return vi.fn(async () => {
            if (response instanceof Error) {
                throw response;
            }
            return response;
        });
    }

    function json(status: number, body: unknown): Response {
        return new Response(JSON.stringify(body), {status, headers: {'Content-Type': 'application/problem+json'}});
    }

    it('asks for a configuration first when there is none, without any network call', async () => {
        const fetchImpl = fakeFetch(json(200, pingBody));
        const outcome = await testConnection(path, {fetchImpl: fetchImpl as unknown as typeof fetch, machineIdSources, platform: 'linux'});
        expect(outcome).toEqual({level: 'error', message: expect.stringMatching(/Paste a configuration/)});
        expect(fetchImpl).not.toHaveBeenCalled();
    });

    it('pings the saved URL with this machine fingerprint', async () => {
        saveConfigurationString(encode(configuration), path);
        const fetchImpl = fakeFetch(json(200, pingBody));
        await testConnection(path, {fetchImpl: fetchImpl as unknown as typeof fetch, machineIdSources, platform: 'linux'});

        const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
        const {localUuid} = readOnlineSettings(path);
        expect(url).toBe('https://api.example.org/api/v1/ping');
        expect((init.headers as Record<string, string>)['X-Maui-Machine'])
            .toBe(computeMachineFingerprint(localUuid, 'os-machine-id'));
        expect((init.headers as Record<string, string>).Authorization).toBe('Bearer 12|secret');
    });

    it('creates localUuid once and reuses it on the next test', async () => {
        saveConfigurationString(encode(configuration), path);
        const deps = {fetchImpl: fakeFetch(json(200, pingBody)) as unknown as typeof fetch, machineIdSources, platform: 'linux' as const};
        await testConnection(path, deps);
        const first = readOnlineSettings(path).localUuid;
        await testConnection(path, {...deps, fetchImpl: fakeFetch(json(200, pingBody)) as unknown as typeof fetch});
        expect(first).not.toBe('');
        expect(readOnlineSettings(path).localUuid).toBe(first);
    });

    it('says when the call just bound this cabinet', async () => {
        saveConfigurationString(encode(configuration), path);
        const outcome = await testConnection(path, {fetchImpl: fakeFetch(json(200, pingBody)) as unknown as typeof fetch, machineIdSources, platform: 'linux'});
        expect(outcome.level).toBe('info');
        expect(outcome.message).toContain('marvelous_mario');
        expect(outcome.message).toMatch(/now bound/);
    });

    it('does not claim a new binding when the cabinet was already bound', async () => {
        saveConfigurationString(encode(configuration), path);
        const alreadyBound = {...pingBody, machine: {...pingBody.machine, newly_bound: false}};
        const outcome = await testConnection(path, {fetchImpl: fakeFetch(json(200, alreadyBound)) as unknown as typeof fetch, machineIdSources, platform: 'linux'});
        expect(outcome.level).toBe('info');
        expect(outcome.message).not.toMatch(/now bound/);
    });

    it('explains a rejection in plain words', async () => {
        saveConfigurationString(encode(configuration), path);
        const fetchImpl = fakeFetch(json(409, {type: 'about:blank', title: 'Conflict', status: 409, code: 'machine_mismatch'}));
        const outcome = await testConnection(path, {fetchImpl: fetchImpl as unknown as typeof fetch, machineIdSources, platform: 'linux'});
        expect(outcome).toEqual({level: 'error', message: describeRejection('machine_mismatch')});
    });

    it('explains rate limiting with the delay', async () => {
        saveConfigurationString(encode(configuration), path);
        const response = new Response('{}', {status: 429, headers: {'Retry-After': '30'}});
        const outcome = await testConnection(path, {fetchImpl: fakeFetch(response) as unknown as typeof fetch, machineIdSources, platform: 'linux'});
        expect(outcome).toEqual({level: 'error', message: expect.stringContaining('30 s')});
    });

    it('explains an unreachable API with its URL', async () => {
        saveConfigurationString(encode(configuration), path);
        const outcome = await testConnection(path, {
            fetchImpl: fakeFetch(new TypeError('fetch failed')) as unknown as typeof fetch, machineIdSources, platform: 'linux',
        });
        expect(outcome).toEqual({level: 'error', message: expect.stringContaining('https://api.example.org')});
    });

    it('explains a server error and a non MAUI-API answer', async () => {
        saveConfigurationString(encode(configuration), path);
        const deps = {machineIdSources, platform: 'linux' as const};
        const serverError = await testConnection(path, {...deps, fetchImpl: fakeFetch(new Response('', {status: 503})) as unknown as typeof fetch});
        expect(serverError).toEqual({level: 'error', message: expect.stringContaining('503')});
        const notApi = await testConnection(path, {...deps, fetchImpl: fakeFetch(new Response('<html>', {status: 200})) as unknown as typeof fetch});
        expect(notApi).toEqual({level: 'error', message: expect.stringMatching(/MAUI-API server/)});
    });

    it('reports a corrupt settings file without calling the API', async () => {
        corruptFile();
        const fetchImpl = fakeFetch(json(200, pingBody));
        const outcome = await testConnection(path, {fetchImpl: fetchImpl as unknown as typeof fetch, machineIdSources, platform: 'linux'});
        expect(outcome).toEqual({level: 'error', message: expect.stringMatching(/online\.json/)});
        expect(fetchImpl).not.toHaveBeenCalled();
    });
});

describe('resetOnlineSettings', () => {
    it('explains that the identity was kept', () => {
        mkdirSync(dirname(path), {recursive: true});
        writeFileSync(path, '{"localUuid": "0b7c2f1e-5a3d-4c8e-9f10-2a3b4c5d6e7f", "tok');
        const outcome = resetOnlineSettings(path);
        expect(outcome.level).toBe('info');
        expect(outcome.message).toMatch(/identity was kept/);
        expect(outcome.message).toMatch(/paste the configuration/i);
        expect(getOnlineView(path)).toEqual({state: 'unconfigured'});
    });

    it('warns that the binding must be reset when the identity is lost', () => {
        corruptFile();
        const outcome = resetOnlineSettings(path);
        expect(outcome.level).toBe('info');
        expect(outcome.message).toMatch(/reset the machine binding/);
    });

    it('does nothing on a readable file', () => {
        saveConfigurationString(encode(configuration), path);
        expect(resetOnlineSettings(path).level).toBe('error');
        expect(getOnlineView(path)).toEqual({state: 'configured', url: configuration.url, key: configuration.key, enabled: false});
    });
});

describe('setOnlineEnabled', () => {
    it('turns ONLINE on and off, keeping the credentials', () => {
        saveConfigurationString(encode(configuration), path);
        expect(setOnlineEnabled(true, path)).toEqual({level: 'info', message: 'ONLINE turned on.'});
        expect(readOnlineSettings(path)).toMatchObject({...configuration, enabled: true});
        expect(setOnlineEnabled(false, path)).toEqual({level: 'info', message: 'ONLINE turned off.'});
        expect(readOnlineSettings(path)).toMatchObject({...configuration, enabled: false});
    });

    it('refuses to turn ONLINE on without credentials', () => {
        expect(setOnlineEnabled(true, path)).toEqual({level: 'error', message: expect.stringMatching(/Paste a configuration/)});
        expect(readOnlineSettings(path).enabled).toBe(false);
    });

    it('does not overwrite a corrupt file', () => {
        corruptFile();
        expect(setOnlineEnabled(false, path)).toEqual({level: 'error', message: expect.stringMatching(/online\.json/)});
    });
});

describe('describeOnlineStatus', () => {
    const base: OnlineStatus = {state: 'running', startupId: null, lastSuccessAt: null, lastFailure: null};
    const url = 'https://api.example.org';

    it('says when ONLINE is off', () => {
        expect(describeOnlineStatus({...base, state: 'disabled'}, url)).toEqual({level: 'info', message: 'ONLINE is off.'});
    });

    it('gives the last contact while running', () => {
        const status = {...base, lastSuccessAt: '2026-09-25T10:01:00.000Z'};
        expect(describeOnlineStatus(status, url)).toEqual({
            level: 'info', message: 'ONLINE is on. Last contact with MAUI-API: 2026-09-25 10:01:00 UTC.',
        });
    });

    it('says when there was no successful contact yet', () => {
        expect(describeOnlineStatus(base, url).message).toMatch(/no successful contact yet/);
    });

    it('adds the last error when it is newer than the last success', () => {
        const status: OnlineStatus = {
            ...base,
            lastSuccessAt: '2026-09-25T10:01:00.000Z',
            lastFailure: {at: '2026-09-25T10:02:00.000Z', result: {kind: 'unavailable', reason: 'network'}},
        };
        const described = describeOnlineStatus(status, url);
        expect(described.level).toBe('error');
        expect(described.message).toContain('2026-09-25 10:02:00 UTC');
        expect(described.message).toContain('unreachable at https://api.example.org');
    });

    it('drops an error older than the last success', () => {
        const status: OnlineStatus = {
            ...base,
            lastSuccessAt: '2026-09-25T10:03:00.000Z',
            lastFailure: {at: '2026-09-25T10:02:00.000Z', result: {kind: 'unavailable', reason: 'network'}},
        };
        expect(describeOnlineStatus(status, url).level).toBe('info');
    });

    it('explains why ONLINE stopped', () => {
        const status: OnlineStatus = {
            ...base,
            state: 'stopped',
            lastFailure: {at: '2026-09-25T10:00:00.000Z', result: {kind: 'rejected', status: 403, code: 'client_disabled'}},
        };
        const described = describeOnlineStatus(status, url);
        expect(described.level).toBe('error');
        expect(described.message).toContain(describeRejection('client_disabled'));
        expect(described.message).toMatch(/Retry/);
    });

    it('explains a stop without an API answer', () => {
        expect(describeOnlineStatus({...base, state: 'stopped'}, url).message).toMatch(/unexpected error/);
    });
});

describe('describeRejection', () => {
    it.each([
        ['unauthenticated', /paste a new configuration/i],
        ['client_disabled', /disabled by the administrator/i],
        ['insufficient_ability', /not for a cabinet/i],
        ['machine_mismatch', /another cabinet/i],
        ['machine_fingerprint_missing', /MAUI bug/i],
        ['validation_failed', /MAUI bug/i],
    ])('explains %s', (code, expected) => {
        expect(describeRejection(code)).toMatch(expected);
    });

    it('names an unknown code', () => {
        expect(describeRejection('something_new')).toContain('something_new');
    });
});
