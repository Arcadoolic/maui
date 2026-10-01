// Client for the MAUI-API calls (contract: maui-api docs/openapi.yaml). Never throws:
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
    // Human-readable OS name, sent only when known (see OsName.ts).
    osName?: string;
    clientDatetime: string;
}

export interface StartupResult {
    id: string;
    receivedAt: string;
}

export interface RepositoryInfo {
    // Base URL of the starting-pack repository, null when this server has none.
    url: string | null;
}

// Players (maui-api D48): only the initials and the visibility ever reach the API.
export type OnlinePlayerStatus = 'active' | 'disabled' | 'locked';

export interface OnlinePlayer {
    // UUID, the only id the API knows the player by.
    id: string;
    pseudo3: string;
    isPublic: boolean;
    status: OnlinePlayerStatus;
}

export type PlayerAvailability = 'free' | 'taken' | 'disabled';

export interface CreatedPlayer {
    player: OnlinePlayer;
    // Shown once to the player, never stored.
    pin: string;
}

export type ApiResult<T> =
    | {kind: 'ok'; value: T}
    // Definitive: retrying with the same credentials gives the same answer. `attemptsLeft` comes
    // with `pin_invalid` only.
    | {kind: 'rejected'; status: number; code: string; errors?: Record<string, string[]>; attemptsLeft?: number}
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
    if (isObject(body) && Number.isInteger(body.attempts_left)) {
        return {...rejected, attemptsLeft: body.attempts_left as number};
    }
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

function parseRepository(body: unknown): RepositoryInfo | null {
    if (!isObject(body) || !(typeof body.url === 'string' || body.url === null)) {
        return null;
    }
    return {url: body.url};
}

const PLAYER_STATUSES: readonly string[] = ['active', 'disabled', 'locked'];
const AVAILABILITIES: readonly string[] = ['free', 'taken', 'disabled'];
const PIN = /^\d{4}$/;

function parsePlayer(body: unknown): OnlinePlayer | null {
    if (!isObject(body) || typeof body.id !== 'string' || typeof body.pseudo_3 !== 'string'
        || typeof body.is_public !== 'boolean' || typeof body.status !== 'string'
        || !PLAYER_STATUSES.includes(body.status)) {
        return null;
    }
    return {id: body.id, pseudo3: body.pseudo_3, isPublic: body.is_public, status: body.status as OnlinePlayerStatus};
}

function parsePlayerResponse(body: unknown): OnlinePlayer | null {
    return isObject(body) ? parsePlayer(body.player) : null;
}

function parsePlayerList(body: unknown): OnlinePlayer[] | null {
    if (!isObject(body) || !Array.isArray(body.players)) {
        return null;
    }
    const players = body.players.map(parsePlayer);
    return players.every(player => player !== null) ? players as OnlinePlayer[] : null;
}

function parseAvailability(body: unknown): PlayerAvailability | null {
    return isObject(body) && typeof body.availability === 'string' && AVAILABILITIES.includes(body.availability)
        ? body.availability as PlayerAvailability
        : null;
}

function parsePin(body: unknown): string | null {
    return isObject(body) && typeof body.pin === 'string' && PIN.test(body.pin) ? body.pin : null;
}

function parseCreatedPlayer(body: unknown): CreatedPlayer | null {
    const player = parsePlayerResponse(body);
    const pin = parsePin(body);
    return player && pin ? {player, pin} : null;
}

function isTimeout(error: unknown): boolean {
    return error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');
}

export class MauiApiClient {
    private readonly fetchImpl: typeof fetch;
    private readonly timeoutMs: number;

    public constructor(private readonly credentials: MauiApiCredentials, options: MauiApiClientOptions = {}) {
        // Never the bare global stored as a property: called as `this.fetchImpl()`, the renderer's
        // browser fetch throws "Illegal invocation" (Node's does not care), seen as a network error.
        this.fetchImpl = options.fetchImpl ?? ((input, init) => fetch(input, init));
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
            ...(report.osName ? {os_name: report.osName.slice(0, MAX_OS_VERSION_LENGTH)} : {}),
            client_datetime: report.clientDatetime,
        };
        return this.call('POST', '/startups', 201, async response => parseStartup(await readJson(response)), body);
    }

    public heartbeat(): Promise<ApiResult<void>> {
        return this.call('POST', '/heartbeat', 204, async () => undefined);
    }

    public repository(): Promise<ApiResult<RepositoryInfo>> {
        return this.call('GET', '/repository', 200, async response => parseRepository(await readJson(response)));
    }

    public listPlayers(): Promise<ApiResult<OnlinePlayer[]>> {
        return this.call('GET', '/players', 200, async response => parsePlayerList(await readJson(response)));
    }

    public playerAvailability(pseudo3: string): Promise<ApiResult<PlayerAvailability>> {
        return this.call(
            'GET', `/players/availability?pseudo_3=${encodeURIComponent(pseudo3)}`, 200,
            async response => parseAvailability(await readJson(response)),
        );
    }

    public createPlayer(pseudo3: string, isPublic: boolean): Promise<ApiResult<CreatedPlayer>> {
        return this.call(
            'POST', '/players', 201, async response => parseCreatedPlayer(await readJson(response)),
            {pseudo_3: pseudo3, is_public: isPublic},
        );
    }

    public linkPlayer(pseudo3: string, pin: string): Promise<ApiResult<OnlinePlayer>> {
        return this.call(
            'POST', '/players/link', 200, async response => parsePlayerResponse(await readJson(response)),
            {pseudo_3: pseudo3, pin},
        );
    }

    public updatePlayer(id: string, isPublic: boolean): Promise<ApiResult<OnlinePlayer>> {
        return this.call(
            'PATCH', `/players/${encodeURIComponent(id)}`, 200, async response => parsePlayerResponse(await readJson(response)),
            {is_public: isPublic},
        );
    }

    public regeneratePin(id: string): Promise<ApiResult<string>> {
        return this.call('POST', `/players/${encodeURIComponent(id)}/pin`, 200, async response => parsePin(await readJson(response)));
    }

    public unlinkPlayer(id: string): Promise<ApiResult<void>> {
        return this.call('DELETE', `/players/${encodeURIComponent(id)}/link`, 204, async () => undefined);
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
        method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
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
