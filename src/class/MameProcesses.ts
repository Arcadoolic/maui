import {readdirSync, readFileSync, readlinkSync, realpathSync} from 'fs';

/**
 * MAME processes the BO did not start itself: a game launched from the MAUI front end (spawned by
 * the renderer, out of the BO server's reach) or by hand. Found by scanning /proc for processes
 * running the configured binary - Linux only (the cabinets), elsewhere there is no /proc and
 * nothing is found.
 */
export function findMameProcesses(mameBinary: string, procRoot = '/proc'): number[] {
    if (!mameBinary) {
        return [];
    }
    const target = resolve(mameBinary);
    let entries: string[];
    try {
        entries = readdirSync(procRoot);
    } catch {
        return [];
    }
    const pids: number[] = [];
    for (const entry of entries) {
        if (!/^\d+$/.test(entry)) {
            continue;
        }
        if (readExe(`${procRoot}/${entry}`) === target || readArgv0(`${procRoot}/${entry}`) === target) {
            pids.push(Number(entry));
        }
    }
    return pids;
}

/**
 * Command-line arguments of a process (argv[0] excluded), empty if it is gone or unreadable. Used
 * to tell which game a MAME found by findMameProcesses() is running: MAUI passes the rom name as a
 * bare argument.
 */
export function readProcessArgs(pid: number, procRoot = '/proc'): string[] {
    try {
        return readFileSync(`${procRoot}/${pid}/cmdline`, 'utf8').split('\0').slice(1).filter(arg => arg !== '');
    } catch {
        return [];
    }
}

/**
 * Asks each process to quit with SIGQUIT, the signal MameService.stopGame() uses (a windowed MAME
 * ignores SIGTERM), then SIGKILLs whatever is still there after `graceMs`. Resolves once they are
 * all gone, or after a last short wait if even SIGKILL did not take.
 */
export async function stopMameProcesses(pids: number[], graceMs = 3000): Promise<void> {
    signal(pids, 'SIGQUIT');
    if (await waitForExit(pids, graceMs)) {
        return;
    }
    signal(pids, 'SIGKILL');
    await waitForExit(pids, 1000);
}

function resolve(path: string): string {
    try {
        return realpathSync(path);
    } catch {
        return path;
    }
}

function readExe(pidDir: string): string | null {
    try {
        return resolve(readlinkSync(`${pidDir}/exe`));
    } catch {
        return null;
    }
}

// Fallback when /proc/<pid>/exe is unreadable (another user's process): argv[0], which MAUI and
// the BO both set to the binary's absolute path.
function readArgv0(pidDir: string): string | null {
    try {
        const argv0 = readFileSync(`${pidDir}/cmdline`, 'utf8').split('\0')[0];
        return argv0 ? resolve(argv0) : null;
    } catch {
        return null;
    }
}

function signal(pids: number[], name: NodeJS.Signals): void {
    for (const pid of pids) {
        try {
            process.kill(pid, name);
        } catch {
            // Already gone.
        }
    }
}

export function isProcessAlive(pid: number): boolean {
    try {
        process.kill(pid, 0);
        return true;
    } catch (error) {
        // EPERM: it exists, just not ours to signal.
        return (error as NodeJS.ErrnoException).code === 'EPERM';
    }
}

async function waitForExit(pids: number[], timeoutMs: number): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (pids.some(isProcessAlive)) {
        if (Date.now() >= deadline) {
            return false;
        }
        await new Promise(resolveWait => setTimeout(resolveWait, 100));
    }
    return true;
}
