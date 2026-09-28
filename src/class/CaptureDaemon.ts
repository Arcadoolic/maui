import {mkdtempSync, readFileSync, writeFileSync} from 'fs';
import {basename, dirname, join, resolve as resolvePath} from 'path';
import os from 'os';
import {isPackaged} from '@/isPackaged';

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

/**
 * A fresh directory holding the daemon script, pointed at that directory. The caller removes it
 * once MAME has exited.
 */
export function prepareCaptureDir(publicPath: string): {dir: string; scriptPath: string} {
    const dir = mkdtempSync(join(os.tmpdir(), 'maui-capture-'));
    const template = readFileSync(join(publicPath, 'lua', SCRIPT_NAME), 'utf8');
    const scriptPath = join(dir, SCRIPT_NAME);
    writeFileSync(scriptPath, template.replace('__CAPTURE_DIR__', dir), 'utf8');
    return {dir, scriptPath};
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
