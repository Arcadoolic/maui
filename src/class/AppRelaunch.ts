// How the application comes back after the BO deleted or replaced what its screen was built on
// (Danger zone, MAUI import): it must restart as a new process (onReset in background.ts).
//
// - manual: under `electron-vite dev`, Electron is a child of the dev server, and app.relaunch()'s
//   new process is not tied to it: nothing would come back. `just serve` again.
// - kiosk: the dedicated cabinet restarts its whole session, as after an update (KioskRestart.ts).
//   Without the sudo rule that allows it, back to manual.
// - self: an installed application (AppImage, Windows installer, macOS) relaunches itself.
export type RelaunchMode = 'manual' | 'kiosk' | 'self';

export interface RelaunchContext {
    isPackaged: boolean;
    // The dedicated cabinet's layout (KioskRestart.ts isKioskLayout()).
    kiosk: boolean;
    canRestartKiosk: () => Promise<boolean>;
}

export async function chooseRelaunch(context: RelaunchContext): Promise<RelaunchMode> {
    if (!context.isPackaged) {
        return 'manual';
    }
    if (context.kiosk) {
        return await context.canRestartKiosk() ? 'kiosk' : 'manual';
    }
    return 'self';
}

/**
 * app.relaunch()'s options. An AppImage runs from a mount that goes away with the process: it is
 * relaunched from the AppImage file itself (APPIMAGE, set by its runtime), with the same arguments.
 */
export function relaunchOptions(appImage: string | undefined, argv: readonly string[]): {execPath?: string; args?: string[]} {
    return appImage ? {execPath: appImage, args: argv.slice(1)} : {};
}
