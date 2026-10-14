import {existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync} from 'fs';
import {isAbsolute, join, sep} from 'path';
import * as os from 'os';
import {parseMameIni} from '@/class/MameIniParser';

// Where mame's own files are, read from its ini files, and the plugins it ships: what the BO shows
// and repairs on its MAME tab, and what the setup guide checks (SetupFacts.ts) from the main
// process, without the BO. Electron-free: MameService.class.ts and Helpers.class.ts import
// @electron/remote, which the main process cannot.

/**
 * Same relative-path resolution Helpers.getFirstExistingDirectory() applies to each
 * candidate: expands $HOME/~, then joins onto parentPath when the path isn't absolute.
 */
export function resolveDirectoryPath(path: string, parentPath: string): string {
    path = path.replace(/\$HOME|~/, os.homedir);
    // isAbsolute(), not path[0] === '/': a Windows absolute path (C:\..., \\server\share) never
    // starts with '/', so that check let one fall through and get wrongly joined onto
    // parentPath (e.g. pluginsPath "C:\MAME\plugins" becoming "<mame home>\C:\MAME\plugins",
    // which never exists - silently emptying getAvailablePlugins() and skipping plugin.ini).
    if (isAbsolute(path)) {
        return path;
    }
    parentPath = parentPath.replace('$HOME', os.homedir);
    const parentPathArray = parentPath.split(sep);
    const pathArray = path.split(sep);
    if (parentPathArray[parentPathArray.length - 1] === pathArray[0]) {
        pathArray.shift();
        path = pathArray.join(sep);
    }
    return join(parentPath, path);
}

/**
 * Same directory-resolution logic as Helpers.getFirstExistingDirectory(): returns the
 * first of `paths` (as declared in an ini file, e.g. ui.ini's marquees_directory) that
 * exists on disk, resolved against `parentPath` when relative. Duplicated for the same
 * reason as getMameHomePath(): avoids pulling in Helpers.class.ts's @electron/remote
 * import at module scope.
 */
export function getFirstExistingDirectory(paths: string[], parentPath: string, file?: string): string | null {
    for (const rawPath of paths) {
        let path = resolveDirectoryPath(rawPath, parentPath);
        if (file) {
            path = join(path, file);
        }
        if (existsSync(path)) {
            return path;
        }
    }
    return null;
}

/**
 * Same lookup as getFirstExistingDirectory(), but when none of the declared paths exist
 * yet, creates and returns the first one instead of null - so roms/marquees/flyers always
 * have a usable directory to drop assets into, right from the dedicated mame home.
 */
export function ensureFirstDirectory(paths: string[] | undefined, parentPath: string): string | null {
    if (!paths || !paths.length) {
        return null;
    }
    const existing = getFirstExistingDirectory(paths, parentPath);
    if (existing) {
        return existing;
    }
    const target = resolveDirectoryPath(paths[0], parentPath);
    mkdirSync(target, {recursive: true});
    return target;
}

/**
 * Resolves the directories/file ui.ini points mame-awesome-ui at: marquees, flyers, logos and
 * the categorypath folder (created if missing, see ensureFirstDirectory) - and favorites.ini /
 * genre.ini / Multiplayer.ini within it (never created themselves: mame itself writes
 * favorites.ini the first time a favorite is added, and genre.ini/Multiplayer.ini are only ever
 * written by a starting pack import (see PackImport.ts), which every pack
 * bundles a copy of both).
 */
export interface MameLocations {
    uiIni: { [key: string]: string[] };
    marqueePath: string | null;
    flyerPath: string | null;
    logoPath: string | null;
    favoritesPath: string | null;
    // Directory genre.ini/Multiplayer.ini live (or will be written) in - always created if
    // missing, so a starting pack import always has somewhere to write them into.
    categoryDir: string | null;
    genreIniPath: string | null;
    // Optional progettoSNAPS catver.ini: read instead of genre.ini when present (see
    // GameService.getGameCategories()).
    catverIniPath: string | null;
    nplayersIniPath: string | null;
}

export function getMameLocations(iniPath: string): MameLocations {
    const uiIniPath = join(iniPath, 'ui.ini');
    const uiIni = existsSync(uiIniPath) ? parseMameIni(readFileSync(uiIniPath, 'utf8')) : {};
    const marqueePath = ensureFirstDirectory(uiIni.marquees_directory, iniPath);
    const flyerPath = ensureFirstDirectory(uiIni.flyers_directory, iniPath);
    // ui.ini's own name for mame's game-logo ("wheel") art directory - defaults to "logo".
    const logoPath = ensureFirstDirectory(uiIni.logos_directory, iniPath);
    const favoritesPath = uiIni.ui_path ? getFirstExistingDirectory(uiIni.ui_path, iniPath, 'favorites.ini') : null;
    // ui.ini's categorypath points at the "folders" directory holding genre.ini,
    // Multiplayer.ini, category.ini, etc. - the same per-version datasets mame-awesome-ui used
    // to bundle stale copies of (public/data/genre_206.ini, nplayers_206.ini) instead of
    // reading from here.
    const categoryDir = ensureFirstDirectory(uiIni.categorypath, iniPath);
    const genreIniPath = categoryDir && existsSync(join(categoryDir, 'genre.ini'))
        ? join(categoryDir, 'genre.ini')
        : null;
    const catverIniPath = categoryDir && existsSync(join(categoryDir, 'catver.ini'))
        ? join(categoryDir, 'catver.ini')
        : null;
    const nplayersIniPath = categoryDir && existsSync(join(categoryDir, 'Multiplayer.ini'))
        ? join(categoryDir, 'Multiplayer.ini')
        : null;
    return {
        uiIni, marqueePath, flyerPath, logoPath, favoritesPath, categoryDir, genreIniPath, catverIniPath,
        nplayersIniPath,
    };
}

/**
 * Reads a single key's current value directly out of mame.ini (not via -showconfig, so this
 * works even without the mame binary configured).
 */
export function getMameIniValue(mameIniPath: string, key: string): string | null {
    if (!existsSync(mameIniPath)) {
        return null;
    }
    const parsed = parseMameIni(readFileSync(mameIniPath, 'utf8'));
    return parsed[key]?.[0] ?? null;
}

/**
 * Rewrites a single key's value in mame.ini in place (regex substitution on that one line),
 * preserving every other line, comment and ordering untouched. Returns false if mame.ini
 * doesn't exist yet (mame never bootstrapped its config).
 */
export function setMameIniValue(mameIniPath: string, key: string, value: string): boolean {
    if (!existsSync(mameIniPath)) {
        return false;
    }
    const content = readFileSync(mameIniPath, 'utf8');
    // [ \t], not \s: -createconfig writes empty-valued keys (e.g. "ctrlr") as the key plus
    // trailing spaces, and \s+ would run on into the next line and overwrite its key instead.
    const lineRegex = new RegExp(`^(${key}[ \\t]+)\\S*|^${key}$`, 'm');
    const updated = lineRegex.test(content)
        ? content.replace(lineRegex, (_line, keyAndSpacing?: string) => `${keyAndSpacing ?? key.padEnd(26)}${value}`)
        : `${content.replace(/\s*$/, '')}\n${key.padEnd(27)}${value}\n`;
    writeFileSync(mameIniPath, updated);
    return true;
}

export interface AvailablePlugin {
    name: string;
    defaultStart: boolean;
}

/**
 * Lists every standalone (non-library) plugin mame ships under pluginsPath, by reading each
 * subdirectory's plugin.json manifest - same manifest mame itself uses to populate plugin.ini
 * via -createconfig. Skips "library" plugins (commonui, json, xml...): they're dependencies
 * other plugins require(), not something to toggle on/off themselves.
 */
// Plugins mame-awesome-ui's own features depend on, forced enabled regardless of mame's own
// manifest default - "hiscore" ships with start:"false" upstream, but HiscoreService.class.ts
// needs it running to read the .hi files it writes.
export const REQUIRED_PLUGINS = ['hiscore'];

export function getAvailablePlugins(pluginsPath: string | null): AvailablePlugin[] {
    if (!pluginsPath || !existsSync(pluginsPath)) {
        return [];
    }
    const plugins: AvailablePlugin[] = [];
    for (const entry of readdirSync(pluginsPath, {withFileTypes: true})) {
        if (!entry.isDirectory()) {
            continue;
        }
        const manifestPath = join(pluginsPath, entry.name, 'plugin.json');
        if (!existsSync(manifestPath)) {
            continue;
        }
        try {
            const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
            if (manifest?.plugin?.type !== 'plugin') {
                continue;
            }
            const name = manifest.plugin.name || entry.name;
            plugins.push({
                name,
                defaultStart: REQUIRED_PLUGINS.includes(name) || manifest.plugin.start === 'true',
            });
        } catch {
            // Malformed/unreadable manifest - skip it rather than fail the whole listing.
        }
    }
    return plugins;
}

/**
 * Names of available plugins that plugin.ini doesn't mention at all yet - e.g. plugin.ini was
 * never properly generated (empty/missing) because pluginspath was wrong when mame first ran
 * -createconfig. Existing entries (whatever their value) are left alone; only gaps are reported.
 */
export function getMissingPlugins(pluginIniPath: string, availablePlugins: AvailablePlugin[]): string[] {
    const existing = existsSync(pluginIniPath)
        ? parseMameIni(readFileSync(pluginIniPath, 'utf8'))
        : {};
    return availablePlugins.filter(plugin => !(plugin.name in existing)).map(plugin => plugin.name);
}

/**
 * Appends one line per plugin missing from plugin.ini, using each plugin's own manifest
 * default (plugin.json's "start" field) - the same default mame's own -createconfig would
 * have written. Never touches a plugin that's already listed, however it's currently set.
 */
export function repairPluginIni(pluginIniPath: string, availablePlugins: AvailablePlugin[]): number {
    const existing = existsSync(pluginIniPath)
        ? parseMameIni(readFileSync(pluginIniPath, 'utf8'))
        : {};
    const missing = availablePlugins.filter(plugin => !(plugin.name in existing));
    if (!missing.length) {
        return 0;
    }
    const additions = missing.map(plugin => `${plugin.name.padEnd(27)}${plugin.defaultStart ? '1' : '0'}`);
    const currentContent = existsSync(pluginIniPath) ? readFileSync(pluginIniPath, 'utf8') : '';
    const updated = `${currentContent.replace(/\s*$/, '')}\n${additions.join('\n')}\n`;
    writeFileSync(pluginIniPath, updated);
    return missing.length;
}

/**
 * The plugins mame-awesome-ui needs (REQUIRED_PLUGINS) that plugin.ini does not switch on: listed
 * with another value than 1, or not listed at all.
 */
export function getDisabledRequiredPlugins(pluginIniPath: string): string[] {
    const existing = existsSync(pluginIniPath) ? parseMameIni(readFileSync(pluginIniPath, 'utf8')) : {};
    return REQUIRED_PLUGINS.filter(name => existing[name]?.[0] !== '1');
}
