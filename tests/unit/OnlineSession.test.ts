import {describe, it, expect, beforeEach, afterEach, vi} from 'vitest';
import {mkdtempSync, rmSync, writeFileSync} from 'fs';
import {join} from 'path';
import {tmpdir} from 'os';
import {OnlineSession, type OnlineSessionDeps} from '@/class/OnlineSession';
import {readOnlineSettings, writeOnlineSettings} from '@/class/OnlineSettings';

const INTERVAL = 60_000;
const LOCAL_UUID = '0b7c2f1e-5a3d-4c8e-9f10-2a3b4c5d6e7f';
const configured = {url: 'https://api.example.org', key: 'mk_k', token: '1|t', localUuid: LOCAL_UUID, enabled: true};
const startupBody = {id: '9d5e7f3a-1b2c-4d5e-8f90-a1b2c3d4e5f6', received_at: '2026-09-25T10:00:00Z'};

let dir: string;
let path: string;

beforeEach(() => {
    vi.useFakeTimers({now: new Date('2026-09-25T10:00:00Z')});
    dir = mkdtempSync(join(tmpdir(), 'maui-online-session-'));
    path = join(dir, 'online.json');
});

afterEach(() => {
    vi.useRealTimers();
    rmSync(dir, {recursive: true, force: true});
});

type Route = (url: string, init: RequestInit) => Response;

function problem(status: number, code: string, headers: Record<string, string> = {}): Response {
    return new Response(JSON.stringify({type: 'about:blank', title: 'x', status, code}), {
        status, headers: {'Content-Type': 'application/problem+json', ...headers},
    });
}

const created = () => new Response(JSON.stringify(startupBody), {status: 201});
const noContent = () => new Response(null, {status: 204});

// Answers /startups and /heartbeat from the given handlers, and records every call.
function api(startup: Route = created, heartbeat: Route = noContent) {
    const calls: {path: string; init: RequestInit}[] = [];
    const fetchImpl = vi.fn(async (url: string, init: RequestInit) => {
        const path = new URL(url).pathname.replace('/api/v1', '');
        calls.push({path, init});
        return path === '/startups' ? startup(url, init) : heartbeat(url, init);
    });
    return {fetchImpl: fetchImpl as unknown as typeof fetch, calls};
}

function session(fetchImpl: typeof fetch, overrides: Partial<OnlineSessionDeps> = {}) {
    const log = vi.fn();
    const instance = new OnlineSession({
        settingsPath: path,
        fetchImpl,
        machineIdSources: {readFile: async () => 'os-id', execFile: async () => ''},
        platform: 'linux',
        osRelease: () => '6.8.0-139-generic',
        mauiVersion: '2.6.0',
        readMameVersion: async () => '0.272',
        readOsName: async () => 'Ubuntu 24.04.5 LTS',
        log,
        ...overrides,
    });
    return {instance, log};
}

const paths = (calls: {path: string}[]) => calls.map(call => call.path);

describe('start', () => {
    it('does nothing while ONLINE is disabled', async () => {
        writeOnlineSettings({...configured, enabled: false}, path);
        const {fetchImpl, calls} = api();
        const {instance} = session(fetchImpl);
        await instance.start();
        await vi.advanceTimersByTimeAsync(INTERVAL * 3);
        expect(calls).toEqual([]);
        expect(instance.getStatus().state).toBe('disabled');
    });

    it('does nothing without credentials', async () => {
        writeOnlineSettings({...configured, token: ''}, path);
        const {fetchImpl, calls} = api();
        const {instance} = session(fetchImpl);
        await instance.start();
        expect(calls).toEqual([]);
        expect(instance.getStatus().state).toBe('not_configured');
    });

    it('reports an unreadable settings file without throwing', async () => {
        writeOnlineSettings(configured, path);
        writeFileSync(path, '{broken');
        const {fetchImpl, calls} = api();
        const {instance} = session(fetchImpl);
        await expect(instance.start()).resolves.toBeUndefined();
        expect(calls).toEqual([]);
        expect(instance.getStatus().state).toBe('unreadable');
    });

    it('reports the startup with the versions, then keeps the startup id', async () => {
        writeOnlineSettings(configured, path);
        const {fetchImpl, calls} = api();
        const {instance} = session(fetchImpl);
        await instance.start();

        expect(paths(calls)).toEqual(['/startups']);
        expect(JSON.parse(calls[0].init.body as string)).toEqual({
            mame_version: '0.272',
            maui_version: '2.6.0',
            os: 'linux',
            os_version: '6.8.0-139-generic',
            os_name: 'Ubuntu 24.04.5 LTS',
            client_datetime: '2026-09-25T10:00:00.000Z',
        });
        expect(instance.getStatus()).toMatchObject({
            state: 'running', startupId: startupBody.id, lastSuccessAt: '2026-09-25T10:00:00.000Z', lastFailure: null,
        });
    });

    it('never throws, even when an unexpected error happens while starting', async () => {
        writeOnlineSettings(configured, path);
        const {fetchImpl} = api();
        const {instance, log} = session(fetchImpl, {
            readMameVersion: async () => {
                throw new Error('boom');
            },
        });
        await expect(instance.start()).resolves.toBeUndefined();
        expect(instance.getStatus().state).toBe('stopped');
        expect(log).toHaveBeenCalledWith(expect.stringContaining('boom'));
    });

    it('creates localUuid when missing', async () => {
        writeOnlineSettings({...configured, localUuid: ''}, path);
        const {fetchImpl} = api();
        await session(fetchImpl).instance.start();
        expect(readOnlineSettings(path).localUuid).not.toBe('');
    });
});

describe('heartbeat', () => {
    it('sends one every interval after the startup report', async () => {
        writeOnlineSettings(configured, path);
        const {fetchImpl, calls} = api();
        const {instance} = session(fetchImpl);
        await instance.start();
        await vi.advanceTimersByTimeAsync(INTERVAL - 1);
        expect(paths(calls)).toEqual(['/startups']);
        await vi.advanceTimersByTimeAsync(1);
        expect(paths(calls)).toEqual(['/startups', '/heartbeat']);
        await vi.advanceTimersByTimeAsync(INTERVAL);
        expect(paths(calls)).toEqual(['/startups', '/heartbeat', '/heartbeat']);
        expect(instance.getStatus().lastSuccessAt).toBe('2026-09-25T10:02:00.000Z');
    });

    it('keeps going without a startup id when the startup report fails transiently', async () => {
        writeOnlineSettings(configured, path);
        const {fetchImpl, calls} = api(() => new Response('', {status: 503}));
        const {instance} = session(fetchImpl);
        await instance.start();
        expect(instance.getStatus()).toMatchObject({state: 'running', startupId: null});
        expect(instance.getStatus().lastFailure?.result).toEqual({kind: 'unavailable', reason: 'server_error', status: 503});
        await vi.advanceTimersByTimeAsync(INTERVAL);
        expect(paths(calls)).toEqual(['/startups', '/heartbeat']);
        expect(instance.getStatus().lastSuccessAt).toBe('2026-09-25T10:01:00.000Z');
    });

    it('keeps the fixed interval on network errors', async () => {
        writeOnlineSettings(configured, path);
        const {fetchImpl, calls} = api(created, () => {
            throw new TypeError('fetch failed');
        });
        const {instance} = session(fetchImpl);
        await instance.start();
        await vi.advanceTimersByTimeAsync(INTERVAL * 3);
        expect(paths(calls)).toEqual(['/startups', '/heartbeat', '/heartbeat', '/heartbeat']);
        expect(instance.getStatus()).toMatchObject({
            state: 'running',
            lastFailure: {at: '2026-09-25T10:03:00.000Z', result: {kind: 'unavailable', reason: 'network'}},
        });
    });

    it('waits Retry-After when rate limited, never less than the interval', async () => {
        writeOnlineSettings(configured, path);
        let first = true;
        const {fetchImpl, calls} = api(created, () => {
            if (first) {
                first = false;
                return problem(429, 'rate_limited', {'Retry-After': '150'});
            }
            return noContent();
        });
        const {instance} = session(fetchImpl);
        await instance.start();
        await vi.advanceTimersByTimeAsync(INTERVAL);
        expect(paths(calls)).toEqual(['/startups', '/heartbeat']);
        await vi.advanceTimersByTimeAsync(149_999);
        expect(paths(calls)).toHaveLength(2);
        await vi.advanceTimersByTimeAsync(1);
        expect(paths(calls)).toEqual(['/startups', '/heartbeat', '/heartbeat']);

        const short = api(() => problem(429, 'rate_limited', {'Retry-After': '5'}));
        writeOnlineSettings(configured, path);
        await session(short.fetchImpl).instance.start();
        await vi.advanceTimersByTimeAsync(INTERVAL - 1);
        expect(paths(short.calls)).toEqual(['/startups']);
    });
});

describe('definitive rejections', () => {
    it.each(['unauthenticated', 'client_disabled', 'machine_mismatch', 'something_new'])(
        'stops on %s from the startup report',
        async code => {
            writeOnlineSettings(configured, path);
            const {fetchImpl, calls} = api(() => problem(403, code));
            const {instance, log} = session(fetchImpl);
            await instance.start();
            await vi.advanceTimersByTimeAsync(INTERVAL * 3);
            expect(paths(calls)).toEqual(['/startups']);
            expect(instance.getStatus()).toMatchObject({state: 'stopped', lastFailure: {result: {kind: 'rejected', code}}});
            expect(log).toHaveBeenCalledWith(expect.stringContaining(code));
        },
    );

    it('stops on a rejected heartbeat', async () => {
        writeOnlineSettings(configured, path);
        const {fetchImpl, calls} = api(created, () => problem(401, 'unauthenticated'));
        const {instance} = session(fetchImpl);
        await instance.start();
        await vi.advanceTimersByTimeAsync(INTERVAL * 3);
        expect(paths(calls)).toEqual(['/startups', '/heartbeat']);
        expect(instance.getStatus().state).toBe('stopped');
    });
});

describe('stop and restart', () => {
    it('stop cancels the next heartbeat', async () => {
        writeOnlineSettings(configured, path);
        const {fetchImpl, calls} = api();
        const {instance} = session(fetchImpl);
        await instance.start();
        instance.stop();
        await vi.advanceTimersByTimeAsync(INTERVAL * 3);
        expect(paths(calls)).toEqual(['/startups']);
        expect(instance.getStatus().state).toBe('disabled');
    });

    it('a heartbeat in flight during stop does not reschedule', async () => {
        writeOnlineSettings(configured, path);
        let answer: (response: Response) => void = () => undefined;
        const {fetchImpl, calls} = api(created, () => {
            throw new Error('replaced below');
        });
        const {instance} = session(vi.fn(async (url: string, init: RequestInit) => {
            if (url.endsWith('/heartbeat')) {
                calls.push({path: '/heartbeat', init});
                return new Promise<Response>(resolve => {
                    answer = resolve;
                });
            }
            return fetchImpl(url, init);
        }) as unknown as typeof fetch);
        await instance.start();
        await vi.advanceTimersByTimeAsync(INTERVAL);
        instance.stop();
        answer(noContent());
        await vi.advanceTimersByTimeAsync(INTERVAL * 3);
        expect(paths(calls)).toEqual(['/startups', '/heartbeat']);
        expect(instance.getStatus().state).toBe('disabled');
    });

    it('restart picks up new settings without a new process', async () => {
        writeOnlineSettings({...configured, enabled: false}, path);
        const {fetchImpl, calls} = api();
        const {instance} = session(fetchImpl);
        await instance.start();
        writeOnlineSettings(configured, path);
        await instance.restart();
        expect(paths(calls)).toEqual(['/startups']);
        expect(instance.getStatus().state).toBe('running');

        writeOnlineSettings({...configured, enabled: false}, path);
        await instance.restart();
        await vi.advanceTimersByTimeAsync(INTERVAL * 2);
        expect(paths(calls)).toEqual(['/startups']);
        expect(instance.getStatus().state).toBe('disabled');
    });

    it('restart after a rejection tries again', async () => {
        writeOnlineSettings(configured, path);
        let rejected = true;
        const {fetchImpl} = api(() => (rejected ? problem(401, 'unauthenticated') : created()));
        const {instance} = session(fetchImpl);
        await instance.start();
        expect(instance.getStatus().state).toBe('stopped');
        rejected = false;
        await instance.restart();
        expect(instance.getStatus()).toMatchObject({state: 'running', lastFailure: null});
    });

    it('the heartbeat timer does not keep the process alive', async () => {
        writeOnlineSettings(configured, path);
        const unref = vi.fn();
        const realSetTimeout = globalThis.setTimeout;
        const spy = vi.spyOn(globalThis, 'setTimeout').mockImplementation(((handler: () => void, ms: number) => {
            const timer = realSetTimeout(handler, ms);
            return Object.assign(timer, {unref});
        }) as unknown as typeof setTimeout);
        const {fetchImpl} = api();
        await session(fetchImpl).instance.start();
        spy.mockRestore();
        expect(unref).toHaveBeenCalled();
    });
});

describe('player sync', () => {
    it('syncs the players after the startup report, then every 10 heartbeats', async () => {
        writeOnlineSettings(configured, path);
        const {fetchImpl} = api();
        const syncPlayers = vi.fn(async () => ({kind: 'ok' as const, value: 0}));
        const {instance} = session(fetchImpl, {syncPlayers});

        await instance.start();
        expect(syncPlayers).toHaveBeenCalledTimes(1);

        await vi.advanceTimersByTimeAsync(INTERVAL * 9);
        expect(syncPlayers).toHaveBeenCalledTimes(1);

        await vi.advanceTimersByTimeAsync(INTERVAL);
        expect(syncPlayers).toHaveBeenCalledTimes(2);
        instance.stop();
    });

    it('syncs on demand while running, and tells how it went', async () => {
        writeOnlineSettings(configured, path);
        const {fetchImpl} = api();
        const syncPlayers = vi.fn(async () => ({kind: 'ok' as const, value: 0}));
        const {instance} = session(fetchImpl, {syncPlayers});

        expect(await instance.syncPlayersNow()).toBe('skipped');
        await instance.start();
        expect(await instance.syncPlayersNow()).toBe('ok');
        expect(syncPlayers).toHaveBeenCalledTimes(2);

        syncPlayers.mockRejectedValueOnce(new Error('boom'));
        expect(await instance.syncPlayersNow()).toBe('failed');

        instance.stop();
        expect(await instance.syncPlayersNow()).toBe('skipped');
    });

    it('does not sync when the startup report fails', async () => {
        writeOnlineSettings(configured, path);
        const {fetchImpl} = api(() => problem(503, 'server_error'));
        const syncPlayers = vi.fn(async () => ({kind: 'ok' as const, value: 0}));
        const {instance} = session(fetchImpl, {syncPlayers});

        await instance.start();
        expect(syncPlayers).not.toHaveBeenCalled();
        instance.stop();
    });

    it('logs a failed sync and keeps the heartbeat going', async () => {
        writeOnlineSettings(configured, path);
        const {fetchImpl, calls} = api();
        const syncPlayers = vi.fn(async () => ({kind: 'rejected' as const, status: 403, code: 'insufficient_ability'}));
        const {instance, log} = session(fetchImpl, {syncPlayers});

        await instance.start();
        await vi.advanceTimersByTimeAsync(INTERVAL);

        expect(log).toHaveBeenCalledWith(expect.stringContaining('insufficient_ability'));
        expect(instance.getStatus().state).toBe('running');
        expect(paths(calls)).toEqual(['/startups', '/heartbeat']);
        instance.stop();
    });

    it('survives a sync that throws', async () => {
        writeOnlineSettings(configured, path);
        const {fetchImpl} = api();
        const syncPlayers = vi.fn(async () => {
            throw new Error('SQLITE_BUSY');
        });
        const {instance, log} = session(fetchImpl, {syncPlayers});

        await instance.start();
        await vi.advanceTimersByTimeAsync(0);

        expect(log).toHaveBeenCalledWith(expect.stringContaining('SQLITE_BUSY'));
        expect(instance.getStatus().state).toBe('running');
        instance.stop();
    });
});

describe('score flush', () => {
    const empty = {sent: 0, accepted: 0, notImproved: 0, rejected: {}};

    it('flushes the scores after the startup report and after every heartbeat', async () => {
        writeOnlineSettings(configured, path);
        const {fetchImpl} = api();
        const flushScores = vi.fn(async () => empty);
        const {instance} = session(fetchImpl, {flushScores});

        await instance.start();
        expect(flushScores).toHaveBeenCalledTimes(1);

        await vi.advanceTimersByTimeAsync(INTERVAL * 2);
        expect(flushScores).toHaveBeenCalledTimes(3);
        instance.stop();
    });

    it('flushes on demand while running, one flush at a time', async () => {
        writeOnlineSettings(configured, path);
        const {fetchImpl} = api();
        let release: () => void = () => undefined;
        const flushScores = vi.fn(() => new Promise<typeof empty>(resolve => { release = () => resolve(empty); }));
        const {instance} = session(fetchImpl, {flushScores});

        expect(await instance.flushScoresNow()).toBeNull();
        await instance.start();
        const first = instance.flushScoresNow();
        const second = instance.flushScoresNow();
        release();

        expect(await first).toEqual(empty);
        expect(await second).toEqual(empty);
        expect(flushScores).toHaveBeenCalledTimes(1);
        instance.stop();
    });

    it('logs a failed flush and keeps going', async () => {
        writeOnlineSettings(configured, path);
        const {fetchImpl} = api();
        const flushScores = vi.fn(async () => ({...empty, failure: {kind: 'unavailable' as const, reason: 'network' as const}}));
        const {instance, log} = session(fetchImpl, {flushScores});

        await instance.start();
        await vi.advanceTimersByTimeAsync(0);

        expect(log).toHaveBeenCalledWith(expect.stringContaining('Scores not sent (unavailable)'));
        instance.stop();
    });
});

describe('leaderboard refresh', () => {
    const empty = {sent: 0, accepted: 0, notImproved: 0, rejected: {}};

    it('refreshes after the startup report, with the player sync, and after scores were accepted', async () => {
        writeOnlineSettings(configured, path);
        const {fetchImpl} = api();
        const refreshLeaderboards = vi.fn(async () => undefined);
        let accepted = 0;
        const flushScores = vi.fn(async () => ({...empty, accepted}));
        const {instance} = session(fetchImpl, {refreshLeaderboards, flushScores});

        await instance.start();
        await vi.advanceTimersByTimeAsync(0);
        expect(refreshLeaderboards).toHaveBeenCalledTimes(1);

        await vi.advanceTimersByTimeAsync(INTERVAL * 10);
        expect(refreshLeaderboards).toHaveBeenCalledTimes(2);

        accepted = 1;
        await instance.flushScoresNow();
        await vi.advanceTimersByTimeAsync(0);
        expect(refreshLeaderboards).toHaveBeenCalledTimes(3);
        instance.stop();
    });
});

