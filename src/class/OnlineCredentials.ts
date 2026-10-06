import {toApiBaseUrl} from '@/class/ConfigurationString';
import {computeMachineFingerprint, readOsMachineId, type MachineIdSources} from '@/class/MachineFingerprint';
import type {MauiApiCredentials} from '@/class/MauiApiClient';
import {ensureLocalUuid, getOnlineSettingsPath, type OnlineSettings} from '@/class/OnlineSettings';

// What every MAUI-API call and every repository request carries (see MauiApiClient.ts). Must run
// in Node, on the cabinet itself: see MachineFingerprint.ts.

export interface CredentialsDeps {
    machineIdSources?: MachineIdSources;
    platform?: NodeJS.Platform;
}

export function isOnlineConfigured(settings: OnlineSettings): boolean {
    return settings.url !== '' && settings.key !== '' && settings.token !== '';
}

export async function buildApiCredentials(
    settings: OnlineSettings, path: string = getOnlineSettingsPath(), deps: CredentialsDeps = {},
): Promise<MauiApiCredentials> {
    const {localUuid} = ensureLocalUuid(path);
    const osMachineId = await readOsMachineId(deps.platform, deps.machineIdSources);
    return {
        baseUrl: toApiBaseUrl(settings.url),
        key: settings.key,
        token: settings.token,
        fingerprint: computeMachineFingerprint(localUuid, osMachineId),
    };
}
