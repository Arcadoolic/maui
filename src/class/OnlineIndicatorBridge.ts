import type {OnlineIndicator} from '@/class/OnlineSetup';

// The ONLINE session runs in the main process (background.ts); the front reads its indicator
// through @electron/remote, under this global name. Same states as the BO badge (onlineIndicator()).
export const ONLINE_INDICATOR_GLOBAL = 'mauiOnlineIndicator';

export type OnlineIndicatorReader = () => OnlineIndicator | null;

// The cabinet's name and MAUI-API's environment, which the BO's badge shows after ONLINE / OFFLINE
// (boServer.ts). The front only shows a dot (OnlineBadge.vue).
export interface OnlineIdentity {
    cabinetName: string;
    // MAUI-API's APP_ENV, null when the server did not say.
    environment: string | null;
}

const SEPARATOR = ' \u2022 ';
const ENVIRONMENT_LABELS: Record<string, string> = {production: '', staging: 'STG', local: 'LOCAL'};

/** "broken_terry_bogard • STG": the environment is left out in production. */
export function describeIdentity(identity: OnlineIdentity | null): string {
    if (!identity) {
        return '';
    }
    const environment = identity.environment ?? 'production';
    const label = ENVIRONMENT_LABELS[environment] ?? environment.toUpperCase();
    return [identity.cabinetName, label].filter(part => part !== '').join(SEPARATOR);
}

/** ONLINE or OFFLINE, then what describeIdentity() gave. */
export function badgeLabel(label: string, identity: string): string {
    return identity === '' ? label : label + SEPARATOR + identity;
}

export interface OnlineIndicatorLabel {
    label: string;
    title: string;
}

/** What the front shows for each state; null shows nothing (ONLINE never configured). */
export function describeFrontIndicator(indicator: OnlineIndicator | null): OnlineIndicatorLabel | null {
    switch (indicator) {
        case 'online':
            return {label: 'ONLINE', title: 'Connected to MAUI-API'};
        case 'unstable':
            return {label: 'ONLINE', title: 'MAUI-API not answering, retrying'};
        case 'offline':
            return {label: 'OFFLINE', title: 'ONLINE stopped: see the BO, MAUI > Online'};
        case 'off':
            return {label: 'OFFLINE', title: 'ONLINE is turned off'};
        default:
            return null;
    }
}
