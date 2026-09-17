import {join} from 'path';

/**
 * Directory holding the files shipped in public/ (currently img/ and lua/ -
 * boServer.ts's background.jpg, mame-logo.svg and input-probe.lua).
 *
 * Replaces the __static global, which vue-cli-plugin-electron-builder injected
 * through webpack's DefinePlugin and which electron-vite does not provide. Main
 * process only for now: GameService.class.ts (renderer) stopped needing this
 * entirely once genre.ini/Multiplayer.ini moved to MameService.genreIniPath/
 * nplayersIniPath (resolved from ui.ini, installed by a starting pack import),
 * so the only remaining reader is boServer.ts. Depends on nothing but 'path' and
 * process.resourcesPath, so it stays importable from the renderer too if a
 * future use needs it there.
 *
 * In development the files are served from the repository's public/ directory.
 * In a packaged app electron-builder places them under the resources directory
 * (see electron-builder.yml's extraResources).
 */
export function getStaticPath(): string {
    if (process.env.NODE_ENV === 'development') {
        return join(__dirname, '..', '..', 'public');
    }
    return join(process.resourcesPath, 'public');
}

/**
 * Directory holding scripts/ (currently just import-starting-pack.py) - a separate
 * process spawned by boServer.ts's /import/from-url route, so it needs a real file on
 * disk and can't read anything packed into app.asar the way Node's own require() can.
 * Same dev-vs-packaged split as getStaticPath() above, mirroring electron-builder.yml's
 * extraResources entry for scripts/import-starting-pack.py.
 */
export function getScriptsPath(): string {
    if (process.env.NODE_ENV === 'development') {
        return join(__dirname, '..', '..', 'scripts');
    }
    return join(process.resourcesPath, 'scripts');
}
