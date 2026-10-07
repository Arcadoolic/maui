import {execFile, spawn} from 'child_process';
import {existsSync} from 'fs';
import {homedir} from 'os';
import {join} from 'path';

// The kiosk session of the dedicated Pi (docs/RASPBERRY-PI-DEPLOY.md §5): autologin on tty1 ->
// startx -> ~/.xinitrc -> the app. Restarting this getty unit is what relaunches the whole thing
// on whatever ~/squashfs-root holds, e.g. right after an update.
const KIOSK_SERVICE = 'getty@tty1';

// Absolute path, and exactly the commands the sudoers rule of §5.7 allows: sudo matches the command
// and its arguments as written, so any change here has to be mirrored in that rule.
const SYSTEMCTL = '/usr/bin/systemctl';
const RESTART_COMMAND = [SYSTEMCTL, 'restart', KIOSK_SERVICE];
// The rule's other command, used as a harmless probe: on a healthy unit it does nothing.
const PROBE_COMMAND = [SYSTEMCTL, 'reset-failed', KIOSK_SERVICE];

/**
 * Whether this is the dedicated-system layout of docs/RASPBERRY-PI-DEPLOY.md §5.3/§7: the AppImage
 * extracted once into a fixed ~/squashfs-root, referenced by path from ~/.xinitrc. `isPackaged` is
 * Electron's app.isPackaged, which rules out a repository checkout on a machine that also has a
 * stray ~/squashfs-root from a real install.
 */
export function isKioskLayout(isPackaged: boolean, platform: string = process.platform, home: string = homedir()): boolean {
    return platform === 'linux' && isPackaged && existsSync(join(home, 'squashfs-root', 'AppRun'));
}

type ExecFile = (
    file: string, args: string[], options: {timeout: number}, callback: (error: Error | null) => void,
) => unknown;
type Spawn = (
    command: string, args: string[], options: {detached: boolean; stdio: 'ignore'},
) => {unref(): void};

/**
 * Whether the current user may restart the kiosk session without a password: runs the rule's
 * harmless `reset-failed` for real through `sudo -n` (-n makes it fail instead of prompting). A
 * missing rule, one that needs a password, or no sudo at all come out as false. Not
 * `sudo -n -l <command>`: once any NOPASSWD rule exists, that reports "allowed" for every command
 * sudo permits at all, password or not.
 */
export function canRestartKiosk(exec: ExecFile = execFile as ExecFile): Promise<boolean> {
    return new Promise(resolve => {
        exec('sudo', ['-n', ...PROBE_COMMAND], {timeout: 5000}, error => resolve(!error));
    });
}

/**
 * Asks systemd to restart the kiosk session. Detached and unref'd: the restart ends this very
 * process (the app runs inside the session it restarts), so nothing is waited for or reported back
 * - check canRestartKiosk() first.
 */
export function restartKiosk(spawnFn: Spawn = spawn as Spawn): void {
    spawnFn('sudo', ['-n', ...RESTART_COMMAND], {detached: true, stdio: 'ignore'}).unref();
}
