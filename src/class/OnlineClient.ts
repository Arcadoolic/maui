import {MauiApiClient} from '@/class/MauiApiClient';
import {buildApiCredentials, isOnlineConfigured, type CredentialsDeps} from '@/class/OnlineCredentials';
import {getOnlineSettingsPath, readOnlineSettings} from '@/class/OnlineSettings';

// A MAUI-API client for one action outside OnlineSession (player registration from the cabinet
// UI, BO actions): null while ONLINE is off, not configured or its settings unreadable. Runs in
// Node on the cabinet, renderer included (nodeIntegration): see MachineFingerprint.ts.

export interface OnlineClientDeps extends CredentialsDeps {
    settingsPath?: string;
    fetchImpl?: typeof fetch;
    // false: a client as soon as ONLINE is configured, even while turned off - to get the players
    // ready before turning it on (OnlineReconciliation.ts).
    requireEnabled?: boolean;
}

export async function createOnlineClient(deps: OnlineClientDeps = {}): Promise<MauiApiClient | null> {
    const path = deps.settingsPath ?? getOnlineSettingsPath();
    let settings;
    try {
        settings = readOnlineSettings(path);
    } catch {
        return null;
    }
    if ((deps.requireEnabled !== false && !settings.enabled) || !isOnlineConfigured(settings)) {
        return null;
    }
    return new MauiApiClient(await buildApiCredentials(settings, path, deps), {fetchImpl: deps.fetchImpl});
}
