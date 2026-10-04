import {readdirSync} from 'fs';
import {dirname} from 'path';

/**
 * Self-update on Windows: the BO downloads the installer of the version picked (the NSIS setup
 * electron-builder makes, see electron-builder.yml) and runs it silently. The installer closes
 * the application, replaces it and starts it again - what electron-updater does once it has its
 * file, without its own list of versions: the BO's Update card already has one, shared with the
 * Linux cabinet (releases and development builds alike).
 */

// The only Windows arch electron-builder.yml builds.
const WINDOWS_ARCHS: readonly string[] = ['x64'];

/** Among a release's asset names, the installer for this arch; null when it ships none (a release from before the installer). */
export function findWindowsInstaller(assetNames: readonly string[], arch: string): string | null {
    if (!WINDOWS_ARCHS.includes(arch)) {
        return null;
    }
    return assetNames.find(name => name.includes('-setup-') && name.endsWith(`-win-${arch}.exe`)) ?? null;
}

/**
 * Whether the running application was put there by the installer: it leaves its uninstaller next
 * to the application's .exe. The portable .exe of the earlier versions, unpacked in a temporary
 * folder at each start, has none - and nothing an installer could replace.
 */
export function isInstalledByInstaller(execPath: string, listDirectory: (path: string) => string[] = readdirSync): boolean {
    try {
        return listDirectory(dirname(execPath)).some(name => /^Uninstall .+\.exe$/i.test(name));
    } catch {
        return false;
    }
}

/**
 * Arguments of a silent update, the ones electron-updater passes: --updated (an update, shortcuts
 * are left as they are), /S (no window), --force-run (start the application again once done).
 */
export const WINDOWS_INSTALLER_ARGS: readonly string[] = ['--updated', '/S', '--force-run'];
