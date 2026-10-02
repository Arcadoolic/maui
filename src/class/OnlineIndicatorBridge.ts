import type {OnlineIndicator} from '@/class/OnlineSetup';

// The ONLINE session runs in the main process (background.ts); the front reads its indicator
// through @electron/remote, under this global name. Same states as the BO badge (onlineIndicator()).
export const ONLINE_INDICATOR_GLOBAL = 'mauiOnlineIndicator';

export type OnlineIndicatorReader = () => OnlineIndicator | null;

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
