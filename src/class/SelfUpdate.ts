import {app as electronApp} from 'electron';
import {spawn} from 'child_process';
import {chmodSync, createWriteStream, existsSync, mkdirSync, mkdtempSync, renameSync, rmSync} from 'fs';
import {rm} from 'fs/promises';
import {homedir, tmpdir} from 'os';
import {dirname, join} from 'path';
import {Readable, Transform} from 'stream';
import {pipeline} from 'stream/promises';
import {countEntries, extractAppImage} from '@/class/AppImageExtract';
import {canRestartKiosk, isKioskLayout, restartKiosk} from '@/class/KioskRestart';
import {findLinuxAppImage} from '@/class/LinuxUpdate';
import {findWindowsInstaller, isInstalledByInstaller, WINDOWS_INSTALLER_ARGS} from '@/class/WindowsUpdate';
import type {UpdateStep} from '@/class/FrontUpdateBridge';

// Installing another version of MAUI, from the BO's Update card or from the front (FrontUpdate.ts):
// the file GitHub lists for this machine is downloaded, then
// - dedicated Linux cabinet: the AppImage is extracted and swapped into ~/squashfs-root, and the
//   kiosk session restarted on it (KioskRestart.ts);
// - Windows: the installer runs silently, closes the application and starts the new version.
// Main process only (electron's app): the BO is loaded on demand, the front's update must not
// need it.

// The steps of an installation are the ones the front shows (FrontUpdateBridge.ts).
export type UpdateProgress = (step: Extract<UpdateStep, {step: 'download' | 'extract' | 'switch' | 'cleanup'}>) => void;

// How often a download reports, at most: a line per megabyte in the BO, a bar on the front.
const DOWNLOAD_REPORT_BYTES = 1024 * 1024;

export function getSquashfsRootPath(): string {
    return join(homedir(), 'squashfs-root');
}

/** The dedicated-system layout (KioskRestart.ts). */
export function isKioskInstall(): boolean {
    return isKioskLayout(electronApp.isPackaged);
}

/** On Windows, an application put there by its installer (WindowsUpdate.ts). */
export function isWindowsInstall(): boolean {
    return process.platform === 'win32' && electronApp.isPackaged && isInstalledByInstaller(process.execPath);
}

/** Whether this machine can install another version by itself. */
export function isSelfUpdateCapable(): boolean {
    return isKioskInstall() || isWindowsInstall();
}

/** Among a release's asset names, the file this machine installs; null when it ships none. */
export function findInstallAsset(assetNames: readonly string[]): string | null {
    return process.platform === 'win32'
        ? findWindowsInstaller(assetNames, process.arch)
        : findLinuxAppImage(assetNames, process.arch);
}

/** Downloads a release asset to `destination`, reporting every megabyte. */
export async function downloadUpdateAsset(downloadUrl: string, destination: string, progress: UpdateProgress): Promise<void> {
    const response = await fetch(downloadUrl);
    if (!response.ok || !response.body) {
        throw new Error(`Download failed (HTTP ${response.status}).`);
    }
    const totalBytes = Number(response.headers.get('content-length')) || 0;
    let doneBytes = 0;
    let reportedBytes = 0;
    progress({step: 'download', doneBytes, totalBytes});
    await pipeline(
        // Node's fetch typings (undici) and DOM's lib.dom ReadableStream diverge slightly -
        // both are the real web ReadableStream at runtime, fromWeb() just wants any of them.
        Readable.fromWeb(response.body as import('stream/web').ReadableStream<Uint8Array>),
        new Transform({
            transform(chunk, _enc, callback) {
                doneBytes += chunk.length;
                if (doneBytes - reportedBytes >= DOWNLOAD_REPORT_BYTES) {
                    reportedBytes = doneBytes;
                    progress({step: 'download', doneBytes, totalBytes});
                }
                callback(null, chunk);
            },
        }),
        createWriteStream(destination),
    );
    progress({step: 'download', doneBytes, totalBytes: totalBytes || doneBytes});
}

/**
 * Windows: downloads the installer and returns its path. Kept in a folder of its own under the
 * temporary directory, emptied first - the installer cannot delete itself while it runs.
 */
export async function downloadWindowsInstaller(downloadUrl: string, progress: UpdateProgress): Promise<string> {
    const workDir = join(tmpdir(), 'mame-awesome-ui-update');
    rmSync(workDir, {recursive: true, force: true});
    mkdirSync(workDir, {recursive: true});
    const destination = join(workDir, 'mame-awesome-ui-setup.exe');
    await downloadUpdateAsset(downloadUrl, destination, progress);
    return destination;
}

/**
 * Runs the installer downloaded by downloadWindowsInstaller() and ends this process, which the
 * installer replaces and starts again (--force-run). `exit` is given time to finish what the caller
 * still has to send.
 */
export function runWindowsInstaller(installerPath: string, exit: () => void): void {
    spawn(installerPath, [...WINDOWS_INSTALLER_ARGS], {detached: true, stdio: 'ignore'}).unref();
    exit();
}

/**
 * Downloads `downloadUrl` (a raw release asset - real releases and develop-prerelease builds
 * are published the same way) and swaps it into ~/squashfs-root - same end state as
 * docs/RASPBERRY-PI-DEPLOY.md §7's manual `rm -rf` + re-extract, but via an atomic rename into a
 * fresh temp dir first, so ~/squashfs-root.old stays available as a manual rollback if the new
 * version turns out broken, and the currently-running process's own files are never touched
 * mid-extraction. Throws on failure, the installed version left as it was.
 */
export async function installAppImage(downloadUrl: string, progress: UpdateProgress): Promise<void> {
    const squashfsRoot = getSquashfsRootPath();
    // Next to ~/squashfs-root, not in os.tmpdir(): /tmp is a separate tmpfs on Debian/Raspberry Pi
    // OS, and renameSync() across devices fails with EXDEV - which used to happen *after* the
    // current install had already been moved to .old, leaving no ~/squashfs-root at all.
    const workDir = mkdtempSync(join(dirname(squashfsRoot), '.mame-awesome-ui-update-'));
    // The size of the installed version, counted while downloading: the extraction's estimate.
    const totalEntries = countEntries(squashfsRoot);
    try {
        const appImagePath = join(workDir, 'download.AppImage');
        await downloadUpdateAsset(downloadUrl, appImagePath, progress);

        chmodSync(appImagePath, 0o755);

        // Asynchronous: a synchronous extraction froze the main process (BO and front) for minutes.
        const total = await totalEntries;
        progress({step: 'extract', entries: 0, totalEntries: total});
        await extractAppImage(appImagePath, workDir, entries => progress({step: 'extract', entries, totalEntries: total}));

        const newSquashfsRoot = join(workDir, 'squashfs-root');
        if (!existsSync(newSquashfsRoot)) {
            throw new Error('Extraction finished but squashfs-root was not found in the AppImage.');
        }

        const oldSquashfsRoot = `${squashfsRoot}.old`;
        // The previous .old is parked in workDir (deleted with it in finally) rather than removed
        // up front, so it can be put back if the swap fails.
        const parkedOldSquashfsRoot = join(workDir, 'previous.old');
        progress({step: 'switch'});
        const hadOld = existsSync(oldSquashfsRoot);
        if (hadOld) {
            renameSync(oldSquashfsRoot, parkedOldSquashfsRoot);
        }
        const hadCurrent = existsSync(squashfsRoot);
        try {
            if (hadCurrent) {
                renameSync(squashfsRoot, oldSquashfsRoot);
            }
            renameSync(newSquashfsRoot, squashfsRoot);
        } catch (error) {
            // Undo, so a failed swap never leaves the machine without ~/squashfs-root (which
            // ~/.xinitrc launches on boot).
            if (!existsSync(squashfsRoot) && hadCurrent && existsSync(oldSquashfsRoot)) {
                renameSync(oldSquashfsRoot, squashfsRoot);
            }
            if (hadOld && !existsSync(oldSquashfsRoot)) {
                renameSync(parkedOldSquashfsRoot, oldSquashfsRoot);
            }
            throw error;
        }
    } finally {
        // The previous backup (a whole version) goes with it: asynchronous too.
        progress({step: 'cleanup'});
        await rm(workDir, {recursive: true, force: true});
    }
}

/**
 * Restarts the kiosk session on the version just installed, `delayMs` from now (what the caller
 * still has to send). False, with nothing done, when sudo does not allow it
 * (docs/RASPBERRY-PI-DEPLOY.md §5.7): the new version then waits for the next start.
 */
export async function restartOnInstalledVersion(delayMs: number): Promise<boolean> {
    if (!await canRestartKiosk()) {
        return false;
    }
    setTimeout(restartKiosk, delayMs);
    return true;
}

// Time the front's last screen ("restarting") stays up before the application goes down.
const FRONT_RESTART_DELAY_MS = 3000;

/**
 * The front's installation (FrontUpdate.ts): installs `downloadUrl` and restarts on it. Windows:
 * the installer closes this process through `exit`, which must end it. Throws, the installed
 * version left as it was, when this machine cannot install or restart by itself.
 */
export async function installAndRestart(downloadUrl: string, progress: UpdateProgress, exit: () => void): Promise<void> {
    if (isWindowsInstall()) {
        const installerPath = await downloadWindowsInstaller(downloadUrl, progress);
        setTimeout(() => runWindowsInstaller(installerPath, exit), FRONT_RESTART_DELAY_MS);
        return;
    }
    if (!isKioskInstall()) {
        throw new Error('This machine cannot install a version by itself.');
    }
    await installAppImage(downloadUrl, progress);
    if (!await restartOnInstalledVersion(FRONT_RESTART_DELAY_MS)) {
        throw new Error('Installed, but MAUI cannot restart by itself: restart the cabinet to run the new version.');
    }
}
