// How the application comes back after the BO deleted or replaced what its screen was built on
// (Danger zone, MAUI import): it must restart as a new process (onReset in background.ts).
//
// - dev: under `electron-vite dev`, Electron is a child of the dev server, and app.relaunch()'s
//   new process would not be tied to it. `just serve` relaunches it instead: it gives the path of
//   a file (MAUI_DEV_RELAUNCH_FILE) that the application writes before closing, and starts it again
//   as long as it finds it.
// - manual: development started without `just serve` (no such file): `just serve` again.
// - kiosk: the dedicated cabinet restarts its whole session, as after an update (KioskRestart.ts).
//   Without the sudo rule that allows it, back to manual.
// - self: an installed application (AppImage, Windows installer, macOS) relaunches itself.
export type RelaunchMode = 'manual' | 'dev' | 'kiosk' | 'self';

export interface RelaunchContext {
    isPackaged: boolean;
    // The dedicated cabinet's layout (KioskRestart.ts isKioskLayout()).
    kiosk: boolean;
    canRestartKiosk: () => Promise<boolean>;
    // MAUI_DEV_RELAUNCH_FILE, set by `just serve`.
    devRelaunchFile?: string;
}

export async function chooseRelaunch(context: RelaunchContext): Promise<RelaunchMode> {
    if (!context.isPackaged) {
        return context.devRelaunchFile ? 'dev' : 'manual';
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
