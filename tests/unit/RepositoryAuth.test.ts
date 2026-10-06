import {describe, it, expect, beforeEach, afterEach, vi} from 'vitest';
import {mkdtempSync, rmSync, writeFileSync} from 'fs';
import {join} from 'path';
import {tmpdir} from 'os';
import {
    describeRepositoryFailure, describeRepositoryResponse, isOnlineActive, resolveRepository,
} from '@/class/RepositoryAuth';
import {writeOnlineSettings, type OnlineSettings} from '@/class/OnlineSettings';
import {computeMachineFingerprint, type MachineIdSources} from '@/class/MachineFingerprint';

const settings: OnlineSettings = {
    url: 'https://api.example.org',
    key: 'mk_7F3aQ9dLx2PzK8wR4mT6vYb1',
    token: '12|secret',
    localUuid: '0f8fad5b-d9cb-469f-a165-70867728950e',
    enabled: true,
};

const machineIdSources: MachineIdSources = {
    readFile: async () => 'os-machine-id\n',
    execFile: async () => '',
};

const fingerprint = computeMachineFingerprint(settings.localUuid, 'os-machine-id');

let dir: string;
let path: string;

beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'maui-repository-auth-'));
    path = join(dir, 'online.json');
});

afterEach(() => {
    rmSync(dir, {recursive: true, force: true});
});

function json(status: number, body: unknown): Response {
    return new Response(JSON.stringify(body), {status, headers: {'Content-Type': 'application/json'}});
}

function fetchReturning(response: Response) {
    return vi.fn(async () => response);
}

function resolve(fetchImpl: ReturnType<typeof vi.fn>) {
    return resolveRepository({
        settingsPath: path, fetchImpl: fetchImpl as unknown as typeof fetch, machineIdSources, platform: 'linux',
    });
}

describe('isOnlineActive', () => {
    it('is false without settings', () => {
        expect(isOnlineActive(path)).toBe(false);
    });

    it('is false when ONLINE is configured but off', () => {
        writeOnlineSettings({...settings, enabled: false}, path);
        expect(isOnlineActive(path)).toBe(false);
    });

    it('is false when ONLINE is on without complete credentials', () => {
        writeOnlineSettings({...settings, token: ''}, path);
        expect(isOnlineActive(path)).toBe(false);
    });

    it('is false when the settings file is unreadable', () => {
        writeFileSync(path, '{not json');
        expect(isOnlineActive(path)).toBe(false);
    });

    it('is true when ONLINE is configured and on', () => {
        writeOnlineSettings(settings, path);
        expect(isOnlineActive(path)).toBe(true);
    });
});

describe('resolveRepository', () => {
    it('refuses without any network call when ONLINE is off', async () => {
        writeOnlineSettings({...settings, enabled: false}, path);
        const fetchImpl = fetchReturning(json(200, {url: 'https://repo.example.org'}));
        expect(await resolve(fetchImpl)).toEqual({ok: false, reason: 'online_disabled'});
        expect(fetchImpl).not.toHaveBeenCalled();
    });

    it('refuses without any network call when ONLINE is not configured', async () => {
        const fetchImpl = fetchReturning(json(200, {url: 'https://repo.example.org'}));
        expect(await resolve(fetchImpl)).toEqual({ok: false, reason: 'not_configured'});
        expect(fetchImpl).not.toHaveBeenCalled();
    });

    it('returns the announced URL and the cabinet headers', async () => {
        writeOnlineSettings(settings, path);
        const fetchImpl = fetchReturning(json(200, {url: 'https://repo.example.org/'}));
        expect(await resolve(fetchImpl)).toEqual({
            ok: true,
            url: 'https://repo.example.org',
            headers: {
                'X-Maui-Key': settings.key,
                'Authorization': 'Bearer 12|secret',
                'X-Maui-Machine': fingerprint,
            },
        });
        expect((fetchImpl.mock.calls[0] as unknown as [string])[0]).toBe('https://api.example.org/api/v1/repository');
    });

    it('reports a server without repository', async () => {
        writeOnlineSettings(settings, path);
        expect(await resolve(fetchReturning(json(200, {url: null})))).toEqual({ok: false, reason: 'no_repository'});
    });

    it('treats an API without the repository route (older server) as a server without repository', async () => {
        writeOnlineSettings(settings, path);
        const notFound = new Response(JSON.stringify({status: 404, code: 'not_found'}), {status: 404});
        expect(await resolve(fetchReturning(notFound))).toEqual({ok: false, reason: 'no_repository'});
    });

    it('refuses an http repository announced by an https API', async () => {
        writeOnlineSettings(settings, path);
        expect(await resolve(fetchReturning(json(200, {url: 'http://repo.example.org'}))))
            .toEqual({ok: false, reason: 'invalid_url'});
    });

    it('refuses a URL that is not http(s)', async () => {
        writeOnlineSettings(settings, path);
        for (const url of ['ftp://repo.example.org', 'not a url', 'file:///etc']) {
            expect(await resolve(fetchReturning(json(200, {url})))).toEqual({ok: false, reason: 'invalid_url'});
        }
    });

    it('accepts an http repository when the API itself is on http (local development)', async () => {
        writeOnlineSettings({...settings, url: 'http://localhost:8080'}, path);
        const access = await resolve(fetchReturning(json(200, {url: 'http://localhost:8081'})));
        expect(access).toMatchObject({ok: true, url: 'http://localhost:8081'});
    });

    it('passes the API failure on', async () => {
        writeOnlineSettings(settings, path);
        const problem = new Response(JSON.stringify({status: 409, code: 'machine_mismatch'}), {status: 409});
        expect(await resolve(fetchReturning(problem))).toEqual({
            ok: false, reason: 'api_failure', failure: {kind: 'rejected', status: 409, code: 'machine_mismatch'},
        });
    });
});


describe('describeRepositoryFailure', () => {
    it('explains each reason', () => {
        const url = 'https://api.example.org';
        expect(describeRepositoryFailure({ok: false, reason: 'online_disabled'}, url)).toMatch(/ONLINE/);
        expect(describeRepositoryFailure({ok: false, reason: 'no_repository'}, url)).toMatch(/does not offer a repository/);
        expect(describeRepositoryFailure({ok: false, reason: 'invalid_url'}, url)).toMatch(/refused/);
        expect(describeRepositoryFailure({
            ok: false, reason: 'api_failure', failure: {kind: 'rejected', status: 403, code: 'client_disabled'},
        }, url)).toMatch(/disabled by the administrator/);
    });
});

describe('describeRepositoryResponse', () => {
    it('reads the API problem code relayed by the repository', async () => {
        const response = new Response(JSON.stringify({status: 409, code: 'machine_mismatch'}), {
            status: 409, headers: {'Content-Type': 'application/problem+json'},
        });
        expect(await describeRepositoryResponse(response)).toMatch(/already used on another cabinet/);
    });

    it('falls back to the HTTP status for any other error', async () => {
        expect(await describeRepositoryResponse(new Response('Not Found', {status: 404}))).toBe('HTTP 404');
        expect(await describeRepositoryResponse(new Response('Bad Gateway', {status: 502})))
            .toBe('HTTP 502 (is MAUI-API reachable from the repository?)');
    });
});
