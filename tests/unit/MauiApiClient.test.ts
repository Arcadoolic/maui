import {describe, it, expect, vi} from 'vitest';
import {MauiApiClient, type MauiApiCredentials, type StartupReport} from '@/class/MauiApiClient';

const credentials: MauiApiCredentials = {
    baseUrl: 'https://api.example.org/api/v1',
    key: 'mk_7F3aQ9dLx2PzK8wR4mT6vYb1',
    token: '12|secret',
    fingerprint: 'a'.repeat(64),
};

const report: StartupReport = {
    mameVersion: '0.272',
    mauiVersion: '2.5.0',
    os: 'linux',
    osVersion: '6.8.0-139-generic',
    clientDatetime: '2026-09-23T18:15:00.123Z',
};

// Problem documents copied from docs/openapi.yaml (components.responses) in maui-api.
const problems = {
    machineFingerprintMissing: {type: 'about:blank', title: 'Bad Request', status: 400, code: 'machine_fingerprint_missing'},
    unauthenticated: {type: 'about:blank', title: 'Unauthorized', status: 401, code: 'unauthenticated'},
    clientDisabled: {type: 'about:blank', title: 'Forbidden', status: 403, code: 'client_disabled'},
    insufficientAbility: {type: 'about:blank', title: 'Forbidden', status: 403, code: 'insufficient_ability'},
    machineMismatch: {
        type: 'about:blank', title: 'Conflict', status: 409,
        detail: 'These credentials are already used on another cabinet.', code: 'machine_mismatch',
    },
    validationFailed: {
        type: 'about:blank', title: 'Unprocessable Content', status: 422, code: 'validation_failed',
        errors: {os: ['The selected os is invalid.']},
    },
    rateLimited: {type: 'about:blank', title: 'Too Many Requests', status: 429, code: 'rate_limited'},
    serverError: {type: 'about:blank', title: 'Internal Server Error', status: 500, code: 'server_error'},
};

const pingBody = {
    client: {key: credentials.key, name: 'marvelous_mario'},
    machine: {bound_at: '2026-09-23T18:15:01Z', newly_bound: true},
    server_time: '2026-09-23T18:15:01Z',
};

function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
    return new Response(JSON.stringify(body), {status, headers: {'Content-Type': 'application/json', ...headers}});
}

function problem(body: {status: number; [field: string]: unknown}, headers: Record<string, string> = {}): Response {
    return new Response(JSON.stringify(body), {
        status: body.status,
        headers: {'Content-Type': 'application/problem+json', ...headers},
    });
}

function clientReturning(response: Response | (() => Promise<Response>)) {
    const fetchImpl = vi.fn(async () => (typeof response === 'function' ? response() : response));
    return {client: new MauiApiClient(credentials, {fetchImpl: fetchImpl as unknown as typeof fetch}), fetchImpl};
}

function requestOf(fetchImpl: ReturnType<typeof vi.fn>): {url: string; init: RequestInit} {
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    return {url, init};
}

describe('requests', () => {
    it('sends the three authentication headers on every call', async () => {
        const {client, fetchImpl} = clientReturning(json(200, pingBody));
        await client.ping();
        const headers = requestOf(fetchImpl).init.headers as Record<string, string>;
        expect(headers['X-Maui-Key']).toBe(credentials.key);
        expect(headers.Authorization).toBe('Bearer 12|secret');
        expect(headers['X-Maui-Machine']).toBe(credentials.fingerprint);
        expect(headers.Accept).toBe('application/json');
    });

    it('calls GET /ping under the base URL, tolerating a trailing slash', async () => {
        const fetchImpl = vi.fn(async () => json(200, pingBody));
        const client = new MauiApiClient(
            {...credentials, baseUrl: 'http://localhost:8080/api/v1/'},
            {fetchImpl: fetchImpl as unknown as typeof fetch},
        );
        await client.ping();
        const {url, init} = requestOf(fetchImpl);
        expect(url).toBe('http://localhost:8080/api/v1/ping');
        expect(init.method).toBe('GET');
    });

    it('never follows redirects, so the token cannot be forwarded elsewhere', async () => {
        const {client, fetchImpl} = clientReturning(json(200, pingBody));
        await client.ping();
        expect(requestOf(fetchImpl).init.redirect).toBe('error');
    });

    it('sets a timeout signal on every call', async () => {
        const {client, fetchImpl} = clientReturning(new Response(null, {status: 204}));
        await client.heartbeat();
        expect(requestOf(fetchImpl).init.signal).toBeInstanceOf(AbortSignal);
    });

    it('posts the startup report as snake_case JSON', async () => {
        const {client, fetchImpl} = clientReturning(json(201, {id: 'x', received_at: 'y'}));
        await client.reportStartup(report);
        const {url, init} = requestOf(fetchImpl);
        expect(url).toBe('https://api.example.org/api/v1/startups');
        expect(init.method).toBe('POST');
        expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json');
        expect(JSON.parse(init.body as string)).toEqual({
            mame_version: '0.272',
            maui_version: '2.5.0',
            os: 'linux',
            os_version: '6.8.0-139-generic',
            client_datetime: '2026-09-23T18:15:00.123Z',
        });
    });

    it('truncates version fields to the contract maximum lengths', async () => {
        const {client, fetchImpl} = clientReturning(json(201, {id: 'x', received_at: 'y'}));
        await client.reportStartup({
            ...report,
            mameVersion: 'm'.repeat(40),
            mauiVersion: '2.5.0+dev.' + 'f'.repeat(40),
            osVersion: 'o'.repeat(80),
        });
        const body = JSON.parse(requestOf(fetchImpl).init.body as string);
        expect(body.mame_version).toHaveLength(32);
        expect(body.maui_version).toHaveLength(32);
        expect(body.os_version).toHaveLength(64);
    });

    it('adds os_name when known, truncated to 64 characters', async () => {
        const {client, fetchImpl} = clientReturning(json(201, {id: 'x', received_at: 'y'}));
        await client.reportStartup({...report, osName: 'Ubuntu 24.04.5 LTS'});
        expect(JSON.parse(requestOf(fetchImpl).init.body as string).os_name).toBe('Ubuntu 24.04.5 LTS');

        const long = clientReturning(json(201, {id: 'x', received_at: 'y'}));
        await long.client.reportStartup({...report, osName: 'n'.repeat(80)});
        expect(JSON.parse(requestOf(long.fetchImpl).init.body as string).os_name).toHaveLength(64);
    });

    it('omits os_name when it is unknown', async () => {
        const {client, fetchImpl} = clientReturning(json(201, {id: 'x', received_at: 'y'}));
        await client.reportStartup({...report, osName: ''});
        expect(JSON.parse(requestOf(fetchImpl).init.body as string)).not.toHaveProperty('os_name');
    });

    it('sends POST /heartbeat without a body', async () => {
        const {client, fetchImpl} = clientReturning(new Response(null, {status: 204}));
        await client.heartbeat();
        const {url, init} = requestOf(fetchImpl);
        expect(url).toBe('https://api.example.org/api/v1/heartbeat');
        expect(init.method).toBe('POST');
        expect(init.body).toBeUndefined();
    });
});

describe('successful responses', () => {
    it('maps the ping response', async () => {
        const {client} = clientReturning(json(200, pingBody));
        expect(await client.ping()).toEqual({
            kind: 'ok',
            value: {
                client: {key: credentials.key, name: 'marvelous_mario'},
                machine: {boundAt: '2026-09-23T18:15:01Z', newlyBound: true},
                serverTime: '2026-09-23T18:15:01Z',
            },
        });
    });

    it('maps the startup response', async () => {
        const {client} = clientReturning(json(201, {id: '9d5e7f3a-1b2c-4d5e-8f90-a1b2c3d4e5f6', received_at: '2026-09-23T18:15:01Z'}));
        expect(await client.reportStartup(report)).toEqual({
            kind: 'ok',
            value: {id: '9d5e7f3a-1b2c-4d5e-8f90-a1b2c3d4e5f6', receivedAt: '2026-09-23T18:15:01Z'},
        });
    });

    it('maps the heartbeat 204', async () => {
        const {client} = clientReturning(new Response(null, {status: 204}));
        expect(await client.heartbeat()).toEqual({kind: 'ok', value: undefined});
    });

    it('treats a success body that does not match the contract as unavailable', async () => {
        const {client} = clientReturning(json(200, {client: {key: 'mk_x'}}));
        expect(await client.ping()).toEqual({kind: 'unavailable', reason: 'invalid_response', status: 200});
    });

    it('treats an unexpected success status as unavailable', async () => {
        const {client} = clientReturning(json(200, {id: 'x', received_at: 'y'}));
        expect(await client.reportStartup(report)).toEqual({kind: 'unavailable', reason: 'invalid_response', status: 200});
    });

    it('treats a non-JSON success body as unavailable', async () => {
        const {client} = clientReturning(new Response('<html>proxy login</html>', {status: 200}));
        expect(await client.ping()).toEqual({kind: 'unavailable', reason: 'invalid_response', status: 200});
    });
});

describe('definitive rejections', () => {
    it.each([
        ['machine_fingerprint_missing', problems.machineFingerprintMissing],
        ['unauthenticated', problems.unauthenticated],
        ['client_disabled', problems.clientDisabled],
        ['insufficient_ability', problems.insufficientAbility],
        ['machine_mismatch', problems.machineMismatch],
    ])('returns rejected with code %s', async (code, body) => {
        const {client} = clientReturning(problem(body));
        expect(await client.heartbeat()).toEqual({kind: 'rejected', status: body.status, code});
    });

    it('keeps the field errors of validation_failed', async () => {
        const {client} = clientReturning(problem(problems.validationFailed));
        expect(await client.reportStartup(report)).toEqual({
            kind: 'rejected',
            status: 422,
            code: 'validation_failed',
            errors: {os: ['The selected os is invalid.']},
        });
    });

    it('branches on the code, not on the title or the status', async () => {
        const {client} = clientReturning(problem({...problems.clientDisabled, title: 'Something else'}));
        expect(await client.ping()).toMatchObject({kind: 'rejected', code: 'client_disabled'});
    });

    it('falls back to http_error when a 4xx body is not a problem document', async () => {
        const {client} = clientReturning(new Response('Not Found', {status: 404}));
        expect(await client.ping()).toEqual({kind: 'rejected', status: 404, code: 'http_error'});
    });

    it('passes an unknown code through as is', async () => {
        const {client} = clientReturning(problem({status: 403, code: 'something_new'}));
        expect(await client.ping()).toEqual({kind: 'rejected', status: 403, code: 'something_new'});
    });
});

describe('rate limiting', () => {
    it('returns the Retry-After delay', async () => {
        const {client} = clientReturning(problem(problems.rateLimited, {'Retry-After': '42'}));
        expect(await client.heartbeat()).toEqual({kind: 'rate_limited', retryAfterSeconds: 42});
    });

    it('defaults to 60 seconds without a usable Retry-After', async () => {
        const {client} = clientReturning(problem(problems.rateLimited));
        expect(await client.heartbeat()).toEqual({kind: 'rate_limited', retryAfterSeconds: 60});

        const {client: withDate} = clientReturning(
            problem(problems.rateLimited, {'Retry-After': 'Wed, 23 Sep 2026 18:16:00 GMT'}),
        );
        expect(await withDate.heartbeat()).toEqual({kind: 'rate_limited', retryAfterSeconds: 60});
    });
});

describe('transient failures', () => {
    it('maps 5xx to unavailable', async () => {
        const {client} = clientReturning(problem(problems.serverError));
        expect(await client.heartbeat()).toEqual({kind: 'unavailable', reason: 'server_error', status: 500});

        const {client: gateway} = clientReturning(new Response('Bad Gateway', {status: 502}));
        expect(await gateway.heartbeat()).toEqual({kind: 'unavailable', reason: 'server_error', status: 502});
    });

    it('maps a network error to unavailable', async () => {
        const {client} = clientReturning(async () => {
            throw new TypeError('fetch failed');
        });
        expect(await client.heartbeat()).toEqual({kind: 'unavailable', reason: 'network'});
    });

    it('maps a timeout to unavailable', async () => {
        const {client} = clientReturning(async () => {
            throw new DOMException('The operation was aborted due to timeout', 'TimeoutError');
        });
        expect(await client.heartbeat()).toEqual({kind: 'unavailable', reason: 'timeout'});
    });

    it('times out for real when the server never answers', async () => {
        const fetchImpl = vi.fn((_url: string, init: RequestInit) => new Promise<Response>((_resolve, reject) => {
            init.signal?.addEventListener('abort', () => reject(init.signal?.reason));
        }));
        const client = new MauiApiClient(credentials, {fetchImpl: fetchImpl as unknown as typeof fetch, timeoutMs: 20});
        expect(await client.heartbeat()).toEqual({kind: 'unavailable', reason: 'timeout'});
    });
});
