// Client for the three Lot 1 MAUI-API calls (contract: maui-api docs/openapi.yaml). Never throws:
// every outcome is an ApiResult, so a failing API can never break MAUI, which stays usable in
// LOCAL mode. Branches on the problem `code`, never on `title` or `detail`, as the contract asks.

export interface MauiApiCredentials {
    // Full API base, `/api/v1` included (see toApiBaseUrl() in ConfigurationString.ts).
    baseUrl: string;
    key: string;
    token: string;
    // See MachineFingerprint.ts.
    fingerprint: string;
}

export interface MauiApiClientOptions {
    fetchImpl?: typeof fetch;
    timeoutMs?: number;
}

export interface PingResult {
    client: {key: string; name: string};
    machine: {boundAt: string; newlyBound: boolean};
    serverTime: string;
}

export interface StartupReport {
    mameVersion: string;
    mauiVersion: string;
    os: 'linux' | 'darwin' | 'win32';
    osVersion: string;
    clientDatetime: string;
}

export interface StartupResult {
    id: string;
    receivedAt: string;
}

export type ApiResult<T> =
    | {kind: 'ok'; value: T}
    // Definitive: retrying with the same credentials gives the same answer.
    | {kind: 'rejected'; status: number; code: string; errors?: Record<string, string[]>}
    | {kind: 'rate_limited'; retryAfterSeconds: number}
    // Transient: worth retrying at the next heartbeat.
    | {kind: 'unavailable'; reason: 'network' | 'timeout' | 'server_error' | 'invalid_response'; status?: number};

export type ApiFailure = Exclude<ApiResult<unknown>, {kind: 'ok'}>;

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_RETRY_AFTER_SECONDS = 60;
const MAX_VERSION_LENGTH = 32;
const MAX_OS_VERSION_LENGTH = 64;

type Json = Record<string, unknown>;

function isObject(value: unknown): value is Json {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function readJson(response: Response): Promise<unknown> {
    try {
        return await response.json();
    } catch {
        return null;
    }
}

function parseRetryAfter(header: string | null): number {
    const seconds = Number(header);
    return header !== null && Number.isInteger(seconds) && seconds >= 0 ? seconds : DEFAULT_RETRY_AFTER_SECONDS;
}

async function toFailure(response: Response): Promise<ApiResult<never>> {
    if (response.status === 429) {
        return {kind: 'rate_limited', retryAfterSeconds: parseRetryAfter(response.headers.get('Retry-After'))};
    }
    if (response.status >= 500) {
        return {kind: 'unavailable', reason: 'server_error', status: response.status};
    }
    const body = await readJson(response);
    const code = isObject(body) && typeof body.code === 'string' ? body.code : 'http_error';
    const rejected: ApiResult<never> = {kind: 'rejected', status: response.status, code};
    return isObject(body) && isObject(body.errors)
        ? {...rejected, errors: body.errors as Record<string, string[]>}
        : rejected;
}

function parsePing(body: unknown): PingResult | null {
    if (!isObject(body) || !isObject(body.client) || !isObject(body.machine)) {
        return null;
    }
    const {client, machine} = body;
    if (typeof client.key !== 'string' || typeof client.name !== 'string'
        || typeof machine.bound_at !== 'string' || typeof machine.newly_bound !== 'boolean'
        || typeof body.server_time !== 'string') {
        return null;
    }
    return {
        client: {key: client.key, name: client.name},
        machine: {boundAt: machine.bound_at, newlyBound: machine.newly_bound},
        serverTime: body.server_time,
    };
}

function parseStartup(body: unknown): StartupResult | null {
    if (!isObject(body) || typeof body.id !== 'string' || typeof body.received_at !== 'string') {
        return null;
    }
    return {id: body.id, receivedAt: body.received_at};
}

function isTimeout(error: unknown): boolean {
    return error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');
}

export class MauiApiClient {
    private readonly fetchImpl: typeof fetch;
    private readonly timeoutMs: number;

    public constructor(private readonly credentials: MauiApiCredentials, options: MauiApiClientOptions = {}) {
        this.fetchImpl = options.fetchImpl ?? fetch;
        this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    }

    public ping(): Promise<ApiResult<PingResult>> {
        return this.call('GET', '/ping', 200, async response => parsePing(await readJson(response)));
    }

    public reportStartup(report: StartupReport): Promise<ApiResult<StartupResult>> {
        const body = {
            mame_version: report.mameVersion.slice(0, MAX_VERSION_LENGTH),
            maui_version: report.mauiVersion.slice(0, MAX_VERSION_LENGTH),
            os: report.os,
            os_version: report.osVersion.slice(0, MAX_OS_VERSION_LENGTH),
            client_datetime: report.clientDatetime,
        };
        return this.call('POST', '/startups', 201, async response => parseStartup(await readJson(response)), body);
    }

    public heartbeat(): Promise<ApiResult<void>> {
        return this.call('POST', '/heartbeat', 204, async () => undefined);
    }

    private headers(hasBody: boolean): Record<string, string> {
        const headers: Record<string, string> = {
            'X-Maui-Key': this.credentials.key,
            'Authorization': `Bearer ${this.credentials.token}`,
            'X-Maui-Machine': this.credentials.fingerprint,
            'Accept': 'application/json',
        };
        return hasBody ? {...headers, 'Content-Type': 'application/json'} : headers;
    }

    private async call<T>(
        method: 'GET' | 'POST',
        path: string,
        expectedStatus: number,
        parse: (response: Response) => Promise<T | null>,
        body?: Json,
    ): Promise<ApiResult<T>> {
        let response: Response;
        try {
            response = await this.fetchImpl(this.credentials.baseUrl.replace(/\/+$/, '') + path, {
                method,
                headers: this.headers(body !== undefined),
                body: body === undefined ? undefined : JSON.stringify(body),
                // The API never redirects: following one could hand the token to another host.
                redirect: 'error',
                signal: AbortSignal.timeout(this.timeoutMs),
            });
        } catch (error) {
            return {kind: 'unavailable', reason: isTimeout(error) ? 'timeout' : 'network'};
        }

        if (!response.ok) {
            return toFailure(response);
        }
        const value = response.status === expectedStatus ? await parse(response) : null;
        return value === null
            ? {kind: 'unavailable', reason: 'invalid_response', status: response.status}
            : {kind: 'ok', value};
    }
}
