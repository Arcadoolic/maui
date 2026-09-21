import {execFile, spawn} from 'child_process';

// The kiosk session of the dedicated Pi (docs/RASPBERRY-PI-DEPLOY.md §5): autologin on tty1 ->
// startx -> ~/.xinitrc -> the app. Restarting this getty unit is what relaunches the whole thing
// on whatever ~/squashfs-root holds, e.g. right after an update.
const KIOSK_SERVICE = 'getty@tty1';

// Absolute path, and exactly the command the sudoers rule of §5.7 allows: sudo matches the command
// and its arguments as written, so any change here has to be mirrored in that rule.
const RESTART_COMMAND = ['/usr/bin/systemctl', 'restart', KIOSK_SERVICE];

type ExecFile = (
    file: string, args: string[], options: {timeout: number}, callback: (error: Error | null) => void,
) => unknown;
type Spawn = (
    command: string, args: string[], options: {detached: boolean; stdio: 'ignore'},
) => {unref(): void};

/**
 * Whether the current user may restart the kiosk session without a password. `sudo -n -l <command>`
 * exits 0 only when the sudoers policy permits exactly that command without asking for anything
 * (-n makes it fail instead of prompting), and runs nothing: a missing rule, a rule needing a
 * password or no sudo at all all come out as false.
 */
export function canRestartKiosk(exec: ExecFile = execFile as ExecFile): Promise<boolean> {
    return new Promise(resolve => {
        exec('sudo', ['-n', '-l', ...RESTART_COMMAND], {timeout: 5000}, error => resolve(!error));
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
