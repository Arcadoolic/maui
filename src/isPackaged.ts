import {existsSync} from 'fs';
import {join} from 'path';

/**
 * Whether this is a packaged build rather than `electron-vite dev`, for code that runs in the
 * renderer as well as in the main process (Electron's own app.isPackaged is main-process only,
 * and importing @electron/remote here would break boServer.ts, see its header comment).
 *
 * A packaged build carries electron-builder's app.asar in process.resourcesPath. In dev,
 * process.resourcesPath is node_modules/electron/dist/resources, which only holds Electron's
 * default_app.asar. Preferred over process.env.NODE_ENV: an inherited NODE_ENV=development
 * (shell profile, launcher script) made a packaged app take the dev branch.
 */
export function isPackaged(): boolean {
    return !!process.resourcesPath && existsSync(join(process.resourcesPath, 'app.asar'));
}
