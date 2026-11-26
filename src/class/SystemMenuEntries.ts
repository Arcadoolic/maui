import type {UpdateCheck} from '@/class/FrontUpdateBridge';

// The front's system menu (the Menu action, SystemMenu.vue): what it lists and what its update
// check says. Electron-free, so it stays unit-testable.

export type SystemMenuEntry = 'update' | 'quit' | 'shutdown';

export interface SystemMenuItem {
    id: SystemMenuEntry;
    label: string;
}

/**
 * A dedicated cabinet (KioskRestart.ts isKioskLayout()) starts MAUI again once it quits, hence
 * "Restart"; elsewhere it just quits, and the machine is not MAUI's to shut down.
 */
export function systemMenuEntries(kiosk: boolean): SystemMenuItem[] {
    return [
        {id: 'update', label: 'Check for MAUI update'},
        {id: 'quit', label: kiosk ? 'Restart MAUI' : 'Quit MAUI'},
        ...(kiosk ? [{id: 'shutdown' as const, label: 'Shut down system'}] : []),
    ];
}

/** The notice of a check that brings no offer. */
export function describeUpdateCheck(result: UpdateCheck | undefined): string {
    switch (result?.status) {
    case 'up-to-date':
        return 'MAUI is up to date.';
    case 'unreachable':
        return 'Updates cannot be checked: GitHub is out of reach.';
    case 'offer':
    case 'bo-only':
        return `MAUI ${result.version} is out: update from the back office.`;
    case 'manual':
        return `MAUI ${result.version} is out: download it to update this computer.`;
    default:
        return 'Updates are not available.';
    }
}
