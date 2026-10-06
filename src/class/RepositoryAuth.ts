import type {MachineIdSources} from '@/class/MachineFingerprint';
import {MauiApiClient, type ApiFailure} from '@/class/MauiApiClient';
import {buildApiCredentials, isOnlineConfigured} from '@/class/OnlineCredentials';
import {getOnlineSettingsPath, readOnlineSettings, type OnlineSettings} from '@/class/OnlineSettings';
import {describeFailure, describeRejection} from '@/class/OnlineSetup';

// Access to the starting-pack repository, an ONLINE feature (maui-api docs/DECISIONS.md D46): its
// URL is announced by MAUI-API (GET /repository), never typed in the BO, and every request to it
// carries the cabinet's own headers, which the repository checks against the API. Since those
// headers hold the token, they only go to the announced URL, never over plain http unless the API
// itself is on http (local development), and repository requests never follow redirects.

export type RepositoryHeaders = Record<'X-Maui-Key' | 'Authorization' | 'X-Maui-Machine', string>;

export type RepositoryFailureReason = 'online_disabled' | 'not_configured' | 'no_repository' | 'invalid_url' | 'api_failure';

export type RepositoryAccess =
    | {ok: true; url: string; headers: RepositoryHeaders}
    | {ok: false; reason: RepositoryFailureReason; failure?: ApiFailure};

export interface RepositoryDeps {
    settingsPath?: string;
    fetchImpl?: typeof fetch;
    machineIdSources?: MachineIdSources;
    platform?: NodeJS.Platform;
}

function readSettings(path: string): OnlineSettings | null {
    try {
        return readOnlineSettings(path);
    } catch {
        // An unreadable file (OnlineSettingsError) counts as ONLINE off; the BO's Online card says why.
        return null;
    }
}

// Local only, no network call: decides whether the repository features are shown at all.
export function isOnlineActive(path: string = getOnlineSettingsPath()): boolean {
    const settings = readSettings(path);
    return settings !== null && isOnlineConfigured(settings) && settings.enabled;
}

function isAcceptedUrl(repositoryUrl: string, apiUrl: string): boolean {
    let repository: URL;
    let api: URL;
    try {
        repository = new URL(repositoryUrl);
        api = new URL(apiUrl);
    } catch {
        return false;
    }
    return repository.protocol === 'https:' || (repository.protocol === 'http:' && api.protocol === 'http:');
}

// No cache: called before each repository action, so a new MAUI_REPOSITORY_URL on the API side
// applies at once, for one small request per action.
export async function resolveRepository(deps: RepositoryDeps = {}): Promise<RepositoryAccess> {
    const path = deps.settingsPath ?? getOnlineSettingsPath();
    const settings = readSettings(path);
    if (settings === null || !isOnlineConfigured(settings)) {
        return {ok: false, reason: 'not_configured'};
    }
    if (!settings.enabled) {
        return {ok: false, reason: 'online_disabled'};
    }

    const credentials = await buildApiCredentials(settings, path, deps);
    const result = await new MauiApiClient(credentials, {fetchImpl: deps.fetchImpl}).repository();
    // 404: a MAUI-API older than the repository route, hence a server without repository.
    if (result.kind === 'rejected' && result.status === 404) {
        return {ok: false, reason: 'no_repository'};
    }
    if (result.kind !== 'ok') {
        return {ok: false, reason: 'api_failure', failure: result};
    }
    if (result.value.url === null || result.value.url === '') {
        return {ok: false, reason: 'no_repository'};
    }
    const url = result.value.url.replace(/\/+$/, '');
    if (!isAcceptedUrl(url, settings.url)) {
        return {ok: false, reason: 'invalid_url'};
    }
    return {
        ok: true,
        url,
        headers: {
            'X-Maui-Key': credentials.key,
            'Authorization': `Bearer ${credentials.token}`,
            'X-Maui-Machine': credentials.fingerprint,
        },
    };
}

export function describeRepositoryFailure(
    access: Extract<RepositoryAccess, {ok: false}>, apiUrl: string = readSettings(getOnlineSettingsPath())?.url ?? '',
): string {
    switch (access.reason) {
        case 'online_disabled':
        case 'not_configured':
            return 'The repository is available in ONLINE mode only (MAUI tab, Online).';
        case 'no_repository':
            return 'This MAUI-API server does not offer a repository.';
        case 'invalid_url':
            return 'The repository URL announced by MAUI-API was refused: it must use https.';
        case 'api_failure':
            return access.failure ? describeFailure(access.failure, apiUrl) : 'MAUI-API error.';
    }
}

// A request the repository refused: its web server relays the API's problem+json as is.
export async function describeRepositoryResponse(response: Response): Promise<string> {
    if (response.status === 502) {
        return 'HTTP 502 (is MAUI-API reachable from the repository?)';
    }
    let body: unknown = null;
    try {
        body = await response.json();
    } catch {
        // Not JSON: a plain error of the repository itself.
    }
    const code = typeof body === 'object' && body !== null && 'code' in body ? (body as {code: unknown}).code : null;
    return typeof code === 'string' ? describeRejection(code) : `HTTP ${response.status}`;
}
