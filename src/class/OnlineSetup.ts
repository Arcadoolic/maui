import {ConfigurationStringError, parseConfigurationString, toApiBaseUrl} from '@/class/ConfigurationString';
import {computeMachineFingerprint, readOsMachineId, type MachineIdSources} from '@/class/MachineFingerprint';
import {MauiApiClient, type ApiResult, type PingResult} from '@/class/MauiApiClient';
import {
    OnlineSettingsError,
    ensureLocalUuid,
    getOnlineSettingsPath,
    readOnlineSettings,
    resetCorruptOnlineSettings,
    writeOnlineSettings,
    type OnlineSettings,
} from '@/class/OnlineSettings';

// What the BO "Online" subtab does, kept out of boServer.ts so it can be unit tested. The token
// never leaves this module towards the page: views only carry the url and the public key.

export type OnlineView =
    | {state: 'unconfigured'}
    | {state: 'configured'; url: string; key: string}
    | {state: 'unreadable'; message: string};

export type SaveOutcome = {ok: true} | {ok: false; error: string};

export interface BoMessage {
    level: 'info' | 'error';
    message: string;
}

export interface ConnectionTestDeps {
    fetchImpl?: typeof fetch;
    machineIdSources?: MachineIdSources;
    platform?: NodeJS.Platform;
}

const REJECTIONS: Record<string, string> = {
    unauthenticated: 'Credentials rejected: paste a new configuration.',
    client_disabled: 'This cabinet is disabled by the administrator of MAUI-API.',
    insufficient_ability: 'These credentials are not for a cabinet.',
    machine_mismatch: 'These credentials are already used on another cabinet: ask the administrator of '
        + 'MAUI-API to reset the machine binding.',
    machine_fingerprint_missing: 'MAUI sent an invalid machine fingerprint (a MAUI bug).',
    validation_failed: 'MAUI sent an invalid request (a MAUI bug).',
};

export function describeRejection(code: string): string {
    return REJECTIONS[code] ?? `Rejected by MAUI-API (code ${code}).`;
}

function unreadableMessage(error: OnlineSettingsError): string {
    return `${error.message}. Fix or delete it: deleting it makes this cabinet a new machine for MAUI-API.`;
}

function isConfigured(settings: OnlineSettings): boolean {
    return settings.url !== '' && settings.key !== '' && settings.token !== '';
}

// Reads the settings, turning a corrupt file into a message instead of an exception.
function readSettings(path: string): OnlineSettings | {unreadable: string} {
    try {
        return readOnlineSettings(path);
    } catch (error) {
        if (error instanceof OnlineSettingsError) {
            return {unreadable: unreadableMessage(error)};
        }
        throw error;
    }
}

export function getOnlineView(path: string = getOnlineSettingsPath()): OnlineView {
    const settings = readSettings(path);
    if ('unreadable' in settings) {
        return {state: 'unreadable', message: settings.unreadable};
    }
    return isConfigured(settings)
        ? {state: 'configured', url: settings.url, key: settings.key}
        : {state: 'unconfigured'};
}

export function saveConfigurationString(input: string, path: string = getOnlineSettingsPath()): SaveOutcome {
    let credentials;
    try {
        credentials = parseConfigurationString(input);
    } catch (error) {
        if (error instanceof ConfigurationStringError) {
            return {ok: false, error: error.message};
        }
        throw error;
    }
    // Never overwrite a corrupt file: it may still hold the localUuid this cabinet is bound with.
    const settings = readSettings(path);
    if ('unreadable' in settings) {
        return {ok: false, error: settings.unreadable};
    }
    writeOnlineSettings({...settings, ...credentials}, path);
    return {ok: true};
}

export function resetOnlineSettings(path: string = getOnlineSettingsPath()): BoMessage {
    const outcome = resetCorruptOnlineSettings(path);
    if (!outcome.reset) {
        return {level: 'error', message: 'The ONLINE settings file is readable: nothing to reset.'};
    }
    const saved = `The damaged file was kept as ${outcome.backupPath}.`;
    return {
        level: 'info',
        message: outcome.localUuidRecovered
            ? `ONLINE settings reset, this cabinet's identity was kept. ${saved} Paste the configuration string again.`
            : 'ONLINE settings reset, the identity of this cabinet could not be recovered: it is a new '
                + `machine for MAUI-API. ${saved} Paste the configuration string again, and ask the `
                + 'administrator of MAUI-API to reset the machine binding if the test is refused.',
    };
}

function describePing(result: ApiResult<PingResult>, url: string): BoMessage {
    switch (result.kind) {
        case 'ok': {
            const {client, machine} = result.value;
            const binding = machine.newlyBound ? ', now bound to these credentials' : '';
            return {level: 'info', message: `Connected: this cabinet is "${client.name}"${binding}.`};
        }
        case 'rejected':
            return {level: 'error', message: describeRejection(result.code)};
        case 'rate_limited':
            return {level: 'error', message: `Too many requests to MAUI-API, try again in ${result.retryAfterSeconds} s.`};
        case 'unavailable':
            return {level: 'error', message: describeUnavailable(result, url)};
    }
}

function describeUnavailable(result: Extract<ApiResult<never>, {kind: 'unavailable'}>, url: string): string {
    switch (result.reason) {
        case 'network':
            return `MAUI-API unreachable at ${url}: check the network and the URL.`;
        case 'timeout':
            return `MAUI-API did not answer in time (${url}).`;
        case 'server_error':
            return `MAUI-API error (HTTP ${result.status}), try again later.`;
        case 'invalid_response':
            return `Unexpected answer from ${url}: is it a MAUI-API server?`;
    }
}

// The first successful ping binds the credentials to this machine (see MachineFingerprint.ts), which
// is why this must run in the BO server process, on the cabinet itself.
export async function testConnection(
    path: string = getOnlineSettingsPath(), deps: ConnectionTestDeps = {},
): Promise<BoMessage> {
    const settings = readSettings(path);
    if ('unreadable' in settings) {
        return {level: 'error', message: settings.unreadable};
    }
    if (!isConfigured(settings)) {
        return {level: 'error', message: 'Paste a configuration string first.'};
    }

    const {localUuid} = ensureLocalUuid(path);
    const osMachineId = await readOsMachineId(deps.platform, deps.machineIdSources);
    const client = new MauiApiClient({
        baseUrl: toApiBaseUrl(settings.url),
        key: settings.key,
        token: settings.token,
        fingerprint: computeMachineFingerprint(localUuid, osMachineId),
    }, {fetchImpl: deps.fetchImpl});
    return describePing(await client.ping(), settings.url);
}
