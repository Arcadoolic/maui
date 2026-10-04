import {app} from 'electron';
import {join} from 'path';

/**
 * Directory holding the files shipped in public/ (currently img/ and lua/ -
 * boServer.ts's background.jpg, mame-logo.svg and device-probe.lua/capture-daemon.lua).
 *
 * Replaces the __static global, which vue-cli-plugin-electron-builder injected
 * through webpack's DefinePlugin and which electron-vite does not provide. Main
 * process only: GameService.class.ts (renderer) stopped needing this entirely once
 * genre.ini/Multiplayer.ini moved to MameService.genreIniPath/nplayersIniPath
 * (resolved from ui.ini, installed by a starting pack import), so the only remaining
 * reader is boServer.ts. It imports `app` from 'electron', which the renderer can't
 * (it would need @electron/remote instead).
 *
 * In development the files are served from the repository's public/ directory.
 * In a packaged app electron-builder places them under the resources directory
 * (see electron-builder.yml's extraResources).
 *
 * Gated on app.isPackaged, not NODE_ENV: an inherited NODE_ENV=development (shell
 * profile, launcher script) made a packaged app resolve to app.asar/public, which
 * doesn't exist, so /background.jpg and /mame-logo.svg answered NotFoundError.
 */
export function getStaticPath(): string {
    if (!app.isPackaged) {
        return join(__dirname, '..', '..', 'public');
    }
    return join(process.resourcesPath, 'public');
}

/**
 * The application icon (build/icon.png, also what electron-builder packages), for the windows on
 * Linux: an AppImage is run without being installed, so the desktop has no .desktop file to find
 * the icon in and shows a generic one in the taskbar and the window switcher. Shipped next to
 * public/ (electron-builder.yml's extraResources). macOS and Windows take the icon from the
 * bundle and the executable.
 */
export function getAppIconPath(): string {
    if (!app.isPackaged) {
        return join(__dirname, '..', '..', 'build', 'icon.png');
    }
    return join(process.resourcesPath, 'icon.png');
}

