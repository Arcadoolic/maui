import {existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync} from 'fs';
import {basename, dirname, join, resolve as resolvePath} from 'path';
import os from 'os';
import {isPackaged} from '@/isPackaged';
import {archiveStamp} from '@/class/LogArchive';

/**
 * Shared by the BO's config session (boServer.ts) and MAUI's own game launches
 * (MameService.startGame()): every MAME they start runs public/lua/capture-daemon.lua, so the BO
 * can list a running game's commands and rebind them live, whoever launched it. The daemon talks
 * through files in its own directory (see the script's header), which the BO finds back from the
 * MAME process's arguments (captureDirFromArgs()).
 */
const SCRIPT_NAME = 'capture-daemon.lua';

/**
 * public/ as seen from the renderer, which can't use staticPath.ts (it imports electron's `app`):
 * same dev-vs-packaged split, dev resolving from the project root like getMigrationsPath().
 */
export function getRendererPublicPath(): string {
    return isPackaged() ? join(process.resourcesPath!, 'public') : resolvePath('./public');
}

const SESSION_REPORT = 'session-report.json';
const KEEP_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Where the daemon's directories are kept: ~/.mame-awesome-ui/captures, not the system's temporary
 * directory, which a cabinet empties at every start. Their session-report.json is what a
 * diagnostic sends about the game's latest sessions (DiagnosticBundle.ts).
 */
export function getCapturesPath(): string {
    return join(os.homedir(), '.mame-awesome-ui', 'captures');
}

/**
 * A fresh directory holding the daemon script, pointed at that directory, named after the game
 * and the time (mslug-20261026-101500-XXXXXX). The directories of more than KEEP_DAYS are deleted
 * on the way.
 */
export function prepareCaptureDir(publicPath: string, romName: string, root = getCapturesPath(), now = new Date()): {dir: string; scriptPath: string} {
    mkdirSync(root, {recursive: true});
    pruneCaptureDirs(root, now);
    const dir = mkdtempSync(join(root, `${romName}-${archiveStamp(now)}-`));
    const template = readFileSync(join(publicPath, 'lua', SCRIPT_NAME), 'utf8');
    const scriptPath = join(dir, SCRIPT_NAME);
    writeFileSync(scriptPath, template.replace('__CAPTURE_DIR__', dir), 'utf8');
    return {dir, scriptPath};
}

function pruneCaptureDirs(root: string, now: Date): void {
    for (const name of readdirSync(root)) {
        try {
            const path = join(root, name);
            if (now.getTime() - statSync(path).mtimeMs > KEEP_DAYS * DAY_MS) {
                rmSync(path, {recursive: true, force: true});
            }
        } catch {
            // Another one is being removed or written: it waits for the next game.
        }
    }
}

/** The session reports of a game's latest sessions, newest first. */
export function listSessionReports(romName: string, root = getCapturesPath()): {name: string; path: string; modified: Date}[] {
    if (!existsSync(root)) {
        return [];
    }
    // The rom name itself is a plain [a-z0-9_] name (checked by the callers): mslug, not mslug2.
    const ofGame = new RegExp(`^${romName}-\\d{8}-\\d{6}-[A-Za-z0-9]{6}$`);
    return readdirSync(root)
        .filter(name => ofGame.test(name))
        .map(name => ({name, path: join(root, name, SESSION_REPORT)}))
        .filter(report => existsSync(report.path))
        .map(report => ({...report, modified: statSync(report.path).mtime}))
        .sort((a, b) => b.modified.getTime() - a.modified.getTime());
}

/**
 * MAME options running the daemon. -background_input: MAME otherwise ignores the gamepad while its
 * window isn't the focused one, which is the case whenever the BO is driven from a browser on the
 * same machine (checked against 0.289).
 */
export function captureLaunchArgs(scriptPath: string): string[] {
    return ['-autoboot_delay', '0', '-autoboot_script', scriptPath, '-background_input'];
}

export function captureDirFromArgs(args: string[]): string | undefined {
    const index = args.indexOf('-autoboot_script');
    const scriptPath = index === -1 ? undefined : args[index + 1];
    return scriptPath && basename(scriptPath) === SCRIPT_NAME ? dirname(scriptPath) : undefined;
}
