import express, {Request, Response} from 'express';
import session from 'express-session';
import {Server} from 'http';
import {
    existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync,
    chmodSync, renameSync, createWriteStream, statfsSync, statSync, lstatSync,
} from 'fs';
import {join, dirname, sep, basename, isAbsolute} from 'path';
import * as os from 'os';
import {randomBytes} from 'crypto';
import {ChildProcess, execFile, execFileSync, spawn} from 'child_process';
import {Readable, Transform} from 'stream';
import {pipeline} from 'stream/promises';
import {app as electronApp} from 'electron';
import multer from 'multer';
import bcrypt from 'bcryptjs';
// Pinned (see package.json) to the last 0.5.x release: 0.5.17+/0.6.x ship optional-chaining
// syntax in methods/inflater.js that the main process's webpack build (older acorn parser)
// fails to parse. Bumping this past 0.5.16 breaks `just serve`/`just build` with a
// "Module parse failed: Unexpected token" error on that file - re-check before upgrading.
import AdmZip from 'adm-zip';
import Config from '@/class/Config.class';
import ScreenScraperClient, {ScreenScraperCredentials} from '@/class/ScreenScraperClient.class';
import {parseUiSeqs, removeTokenFromSeq} from '@/class/MameInputSeq';
import {removeFavorite, addFavorite} from '@/class/MameIniParser';
import {
    computeBiosSizes, computePackOwnership, groupSelectedGames, isPackFullyOwned, listPackGames, PackGameDetail,
    PackOwnership,
} from '@/class/PackOwnership';
import {fetchRemoteZipEntrySizes} from '@/class/ZipCentralDirectory';
import {decodeXmlEntities} from '@/class/XmlEntities';
import {getCategoryIconKey, mergeTtlCategories} from '@/class/CarouselCategories';
import {HISCORES_ONLY_CATEGORY, isMergedCategory} from '@/types/CarouselCategory';
import type {StartingPackManifest} from '@/types/StartingPackManifest';
import {ensureDefaultAvatar} from '@/class/DefaultAvatar';
import {
    findDeletedUser, listDeletedUsers, restoreDeletedUser, purgeDeletedUser, DeletedUserRow,
} from '@/class/UserReservation';
import {findAvatarFile} from '@/class/AvatarFiles';
import {sortByPublishedDesc, formatPublishedAt} from '@/class/ReleaseList';
import {
    MAUI_KEYS, MAUI_CONTROL_CONTEXTS, STANDARD_BUTTON_NAMES, keyLabel, describeGamepadInputs,
} from '@/class/MauiControls';
import ControllerMappings from '@/assets/controllers.json';
import {getStaticPath, getScriptsPath} from '@/staticPath';
// Same *TS import shape as Database.class.ts. Duplicated (not imported) for the same reason
// as the rest of this file: Database.class.ts pulls in GameService.class -> MameService.class
// -> Helpers.class.ts's @electron/remote import at module scope, which would break this
// main-process server. The models themselves (Category/Game/User/Hiscore) are electron-free.
import * as SequelizeTS from 'sequelize-typescript';
const Sequelize = SequelizeTS.Sequelize;
type Sequelize = SequelizeTS.Sequelize;
import Category from '@/model/Category.model';
import Game from '@/model/Game.model';
import User from '@/model/User.model';
import Hiscore from '@/model/Hiscore.model';
import BoUser from '@/model/BoUser.model';
import {UniqueConstraintError, ValidationError} from 'sequelize';

// Augments express-session's own SessionData so req.session.boUserId/etc are typed, instead of
// stashing BO login state in a bespoke cookie/JWT scheme.
declare module 'express-session' {
    interface SessionData {
        boUserId?: number;
        boUsername?: string;
        boRole?: 'admin' | 'user';
    }
}

type Tab = 'mame' | 'screenscraper' | 'favorites' | 'users' | 'maui' | 'account';
type PathField = 'mamePath' | 'pluginsPath';

interface ScreenScraperValues {
    ssDevId: string;
    ssDevPassword: string;
    ssSoftName: string;
    ssUserId: string;
    ssUserPassword: string;
    bezelAspect: '4:3' | '16:9';
}

// One entry per pack on repo.maui.afronob.com's index.json (see
// scripts/generate-repo-manifests.py) - only the fields the picker actually displays are typed
// here, not the full manifest.
interface RepoPack {
    filename: string;
    size: number;
    mtime: number;
    generatedAt?: string;
    gameCount?: number;
    // Set by GET /import/from-url/packs: this pack's manifest compared with the roms already
    // installed. Absent when the manifest could not be fetched or holds nothing to compare.
    ownership?: PackOwnership;
    // Its games, for the expandable list (same manifest, same comparison).
    games?: PackGameDetail[];
    // Size of each BIOS/parent set the pack ships, by name (see computeBiosSizes()).
    biosSizes?: Record<string, number>;
}

const MAME_BINARY_NAMES = ['mame.exe', 'mame64.exe', 'mame'];

/**
 * mame.ini/ui.ini directory settings eligible for a plain folder import (as opposed to the
 * starting pack roms/manifest.json flow below): each holds files mame itself reads/writes there,
 * with no per-file metadata to interpret, so unlike a rom a manifest is never needed to import
 * one - the zip just needs a top-level folder named after `zipFolder` (mame's own conventional
 * basename for that directory), copied wholesale into wherever `iniKey` currently resolves to on
 * this mame home. Deliberately a fixed table, not "every ini key": most other settings are
 * multi-path search lists (rompath, artpath, cheatpath...) or non-directory values, and blindly
 * matching a zip folder name against any of those wouldn't be safe or meaningful. Only the
 * *value* each key resolves to is dynamic (read from mame.ini's own -showconfig output and
 * ui.ini, merged - see the /import route) - the key names and their zip folder names stay fixed
 * here. `categorypath`/`folders` is ui.ini's own directory (default name "folders") for
 * genre.ini/Multiplayer.ini/category.ini - the one from the original "importer des folders/"
 * ask; the rest come from mame.ini.
 */
const IMPORTABLE_MAME_DIRECTORIES: {zipFolder: string; iniKey: string}[] = [
    {zipFolder: 'cfg', iniKey: 'cfg_directory'},
    {zipFolder: 'nvram', iniKey: 'nvram_directory'},
    {zipFolder: 'diff', iniKey: 'diff_directory'},
    {zipFolder: 'comments', iniKey: 'comment_directory'},
    {zipFolder: 'inp', iniKey: 'input_directory'},
    {zipFolder: 'sta', iniKey: 'state_directory'},
    {zipFolder: 'snap', iniKey: 'snapshot_directory'},
    {zipFolder: 'folders', iniKey: 'categorypath'},
];

function findMameBinary(mamePath: string): string|null {
    for (const name of MAME_BINARY_NAMES) {
        if (existsSync(join(mamePath, name))) {
            return name;
        }
    }
    return null;
}

/**
 * Same bootstrap as MameService.class.ts's constructor: mame.ini/ui.ini don't exist until mame
 * writes them via -createconfig at least once. Duplicated here for the usual reason (importing
 * MameService.class.ts would pull in Helpers.class.ts's @electron/remote import) - without it,
 * the BO only ever sees mame.ini/ui.ini once the Electron kiosk window has reached /home at
 * least once (the only other place this bootstrap currently runs), leaving marquees/flyers/
 * favorites unresolvable and /import refusing to work if the BO is used to configure mame on
 * its own.
 */
function ensureMameConfigBootstrapped(mameBinary: string, iniPath: string): void {
    const uiIniPath = join(iniPath, 'ui.ini');
    if (existsSync(uiIniPath)) {
        return;
    }
    // -createconfig always writes mame.ini/ui.ini next to cwd, ignoring -inipath/-homepath, so
    // bootstrap the dedicated home directory by running it from there (same trick
    // MameService.class.ts uses).
    execFileSync(mameBinary, ['-createconfig'], {cwd: iniPath, stdio: ['ignore', 'pipe', 'pipe']});
    if (!existsSync(uiIniPath)) {
        throw new Error(`"${uiIniPath}" not found after -createconfig.`);
    }
    // Same forcing as MameService.class.ts's constructor (the Electron app's own bootstrap
    // path) - see its forceFullscreenDefault() comment for why this can't be left to
    // -createconfig's own default. setMameIniValue() only touches this just-created mame.ini,
    // never a later user/BO preference.
    setMameIniValue(join(iniPath, 'mame.ini'), 'window', '0');
}

/**
 * Same directory MameService pins mame's ini/home to (see Helpers.getMameHomePath()) - a plain
 * ~/.mame, separate from ~/.mame-awesome-ui (this app's own config/database - see
 * Config.class.ts) since it belongs to mame itself, not to mame-awesome-ui. Duplicated here
 * rather than imported, matching the rest of this file's electron-free helpers.
 */
function getMameHomePath(): string {
    const homePath = join(os.homedir(), '.mame');
    if (!existsSync(homePath)) {
        mkdirSync(homePath, {recursive: true});
    }
    return homePath;
}

/**
 * Same fixed <home>/.mame-awesome-ui/mame-awesome-ui.sqlite path Database.class.ts uses (see
 * Config.class.ts's getAppDataPath() comment) - kept identical in dev and production. Ensures
 * the parent directory exists itself (sqlite won't create missing intermediate directories),
 * same as Config.class.ts/Database.class.ts's own constructors - doesn't rely on
 * getMameHomePath() having been called first to create it as a side effect.
 */
function getDatabasePath(): string {
    const appDataPath = join(os.homedir(), '.mame-awesome-ui');
    if (!existsSync(appDataPath)) {
        mkdirSync(appDataPath, {recursive: true});
    }
    return join(appDataPath, 'mame-awesome-ui.sqlite');
}

/**
 * Same fixed <home>/.mame-awesome-ui path as getDatabasePath(), for the favorites name/BIOS
 * cache (see FavoritesCache below) - resolving a favorite's fullname/BIOS is a blocking `mame
 * -lx` process spawn per rom (see getGameXmlInfo()), so the favorites tab reads this cache
 * instead of re-running it on every page load; only "Update favorites" re-resolves and
 * rewrites it.
 */
function getFavoritesCachePath(): string {
    const appDataPath = join(os.homedir(), '.mame-awesome-ui');
    if (!existsSync(appDataPath)) {
        mkdirSync(appDataPath, {recursive: true});
    }
    return join(appDataPath, 'favorites-cache.json');
}

interface FavoritesCacheEntry {
    fullname: string;
    biosName: string | null;
    deviceRoms: string[];
}

interface FavoritesCache {
    updatedAt: string;
    entries: { [romName: string]: FavoritesCacheEntry };
}

function readFavoritesCache(): FavoritesCache | null {
    const cachePath = getFavoritesCachePath();
    if (!existsSync(cachePath)) {
        return null;
    }
    try {
        return JSON.parse(readFileSync(cachePath, 'utf8'));
    } catch {
        // Corrupt/unreadable cache file - treat as absent rather than failing the whole tab.
        return null;
    }
}

function writeFavoritesCache(entries: { [romName: string]: FavoritesCacheEntry }): FavoritesCache {
    const cache: FavoritesCache = {updatedAt: new Date().toISOString(), entries};
    writeFileSync(getFavoritesCachePath(), JSON.stringify(cache));
    return cache;
}

/**
 * A favorite removed from the Games tab: the exact favorites.ini block mame had written for it
 * (see removeFavorite()), plus its cached name/BIOS, so "Restore" can put both back as they were.
 * Stored beside the favorites cache rather than in favorites.ini itself, which is mame's own file
 * (it rewrites it from memory on exit and would drop anything foreign).
 */
interface RemovedFavorite {
    romName: string;
    fullname: string;
    removedAt: string;
    entry: string;
    cache?: FavoritesCacheEntry;
}

function getRemovedFavoritesPath(): string {
    return join(dirname(getFavoritesCachePath()), 'removed-favorites.json');
}

function readRemovedFavorites(): RemovedFavorite[] {
    const path = getRemovedFavoritesPath();
    if (!existsSync(path)) {
        return [];
    }
    try {
        const parsed = JSON.parse(readFileSync(path, 'utf8'));
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        // Corrupt/unreadable file - treat as empty rather than failing the whole tab.
        return [];
    }
}

function writeRemovedFavorites(removed: RemovedFavorite[]): void {
    writeFileSync(getRemovedFavoritesPath(), JSON.stringify(removed));
}

/**
 * Filenames currently sitting in Config's fixed avatarsPath (<home>/.mame-awesome-ui/avatars,
 * created eagerly by Config's constructor). Matches the "<pseudo_3>.png" lookup
 * UserService.class.ts/Champions.vue/Hiscores.vue use in the Electron app itself.
 */
function getAvatarFilenames(config: Config): string[] {
    return readdirSync(config.avatarsPath);
}

/**
 * Same sqlite connection Database.class.ts sets up, minus install()/update() (migrations
 * already ran via the app's own startup) - built directly here rather than importing
 * Database.class.ts, which pulls in GameService.class -> MameService.class ->
 * Helpers.class.ts's @electron/remote import at module scope.
 */
function createSequelize(): Sequelize {
    return new Sequelize({
        dialect: 'sqlite',
        storage: getDatabasePath(),
        models: [Category, Game, User, Hiscore, BoUser],
        logging: false,
    });
}

/**
 * Same ini-line parsing MameService uses for `-showconfig` output. Duplicated for the
 * same reason as getMameHomePath(): importing MameService.class.ts would pull in
 * Helpers.class.ts's @electron/remote import at module scope.
 */
function parseMameIniFile(fileContent: string): { [key: string]: string[] } {
    const target: { [key: string]: string[] } = {};
    const regex = new RegExp(/^([a-z_]+)\s+(.+)$/);
    fileContent.split('\n').forEach((line) => {
        if (line[0] === '#') {
            return;
        }
        const data = regex.exec(line.trim());
        if (data) {
            target[data[1]] = data[2].replace(/^"(.*)"$/, '$1').split(';');
        }
    });
    return target;
}

/**
 * Same relative-path resolution Helpers.getFirstExistingDirectory() applies to each
 * candidate: expands $HOME/~, then joins onto parentPath when the path isn't absolute.
 */
function resolveDirectoryPath(path: string, parentPath: string): string {
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
function getFirstExistingDirectory(paths: string[], parentPath: string, file?: string): string | null {
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
function ensureFirstDirectory(paths: string[] | undefined, parentPath: string): string | null {
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
 * written by a starting pack import (see scripts/import-starting-pack.py), which every pack
 * bundles a copy of both).
 */
interface MameLocations {
    uiIni: { [key: string]: string[] };
    marqueePath: string | null;
    flyerPath: string | null;
    logoPath: string | null;
    favoritesPath: string | null;
    // Directory genre.ini/Multiplayer.ini live (or will be written) in - always created if
    // missing, so a starting pack import always has somewhere to write them into.
    categoryDir: string | null;
    genreIniPath: string | null;
    nplayersIniPath: string | null;
}

function getMameLocations(iniPath: string): MameLocations {
    const uiIniPath = join(iniPath, 'ui.ini');
    const uiIni = existsSync(uiIniPath) ? parseMameIniFile(readFileSync(uiIniPath, 'utf8')) : {};
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
    const nplayersIniPath = categoryDir && existsSync(join(categoryDir, 'Multiplayer.ini'))
        ? join(categoryDir, 'Multiplayer.ini')
        : null;
    return {
        uiIni, marqueePath, flyerPath, logoPath, favoritesPath, categoryDir, genreIniPath, nplayersIniPath,
    };
}

/**
 * Reads a single key's current value directly out of mame.ini (not via -showconfig, so this
 * works even without the mame binary configured).
 */
function getMameIniValue(mameIniPath: string, key: string): string | null {
    if (!existsSync(mameIniPath)) {
        return null;
    }
    const parsed = parseMameIniFile(readFileSync(mameIniPath, 'utf8'));
    return parsed[key]?.[0] ?? null;
}

/**
 * Rewrites a single key's value in mame.ini in place (regex substitution on that one line),
 * preserving every other line, comment and ordering untouched. Returns false if mame.ini
 * doesn't exist yet (mame never bootstrapped its config).
 */
function setMameIniValue(mameIniPath: string, key: string, value: string): boolean {
    if (!existsSync(mameIniPath)) {
        return false;
    }
    const content = readFileSync(mameIniPath, 'utf8');
    const lineRegex = new RegExp(`^(${key}\\s+)\\S+`, 'm');
    const updated = lineRegex.test(content)
        ? content.replace(lineRegex, `$1${value}`)
        : `${content.replace(/\s*$/, '')}\n${key.padEnd(27)}${value}\n`;
    writeFileSync(mameIniPath, updated);
    return true;
}

interface AvailablePlugin {
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
const REQUIRED_PLUGINS = ['hiscore'];

function getAvailablePlugins(pluginsPath: string | null): AvailablePlugin[] {
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
function getMissingPlugins(pluginIniPath: string, availablePlugins: AvailablePlugin[]): string[] {
    const existing = existsSync(pluginIniPath)
        ? parseMameIniFile(readFileSync(pluginIniPath, 'utf8'))
        : {};
    return availablePlugins.filter(plugin => !(plugin.name in existing)).map(plugin => plugin.name);
}

/**
 * Appends one line per plugin missing from plugin.ini, using each plugin's own manifest
 * default (plugin.json's "start" field) - the same default mame's own -createconfig would
 * have written. Never touches a plugin that's already listed, however it's currently set.
 */
function repairPluginIni(pluginIniPath: string, availablePlugins: AvailablePlugin[]): number {
    const existing = existsSync(pluginIniPath)
        ? parseMameIniFile(readFileSync(pluginIniPath, 'utf8'))
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

interface MameInfo {
    iniPath: string;
    mameIniPath: string;
    uiIniPath: string;
    pluginIniPath: string;
    romPath: string | null;
    marqueePath: string | null;
    flyerPath: string | null;
    logoPath: string | null;
    favoritesPath: string | null;
    genreIniPath: string | null;
    nplayersIniPath: string | null;
    windowed: boolean;
    pluginsPath: string | null;
    missingPlugins: string[];
    // Full `-showconfig` output, kept around beyond the rompath it's parsed here for. Null
    // whenever -showconfig itself couldn't run (see the catch branch below).
    showConfig: { [key: string]: string[] } | null;
    error?: string;
}

function getMameInfo(config: Config): MameInfo {
    const iniPath = getMameHomePath();
    const mameIniPath = join(iniPath, 'mame.ini');
    const uiIniPath = join(iniPath, 'ui.ini');
    const pluginIniPath = join(iniPath, 'plugin.ini');
    const {
        marqueePath, flyerPath, logoPath, favoritesPath, genreIniPath, nplayersIniPath,
    } = getMameLocations(iniPath);
    const windowed = getMameIniValue(mameIniPath, 'window') === '1';
    const pluginsPath = getMameIniValue(mameIniPath, 'pluginspath');
    const resolvedPluginsPath = pluginsPath ? resolveDirectoryPath(pluginsPath, iniPath) : null;
    const missingPlugins = getMissingPlugins(pluginIniPath, getAvailablePlugins(resolvedPluginsPath));

    if (!config.mamePath || !config.mameBinaryName) {
        return {
            iniPath, mameIniPath, uiIniPath, pluginIniPath, romPath: null, marqueePath, flyerPath, logoPath,
            favoritesPath, genreIniPath, nplayersIniPath, windowed, pluginsPath, missingPlugins, showConfig: null,
            error: 'Configure the mame binary (Config tab) to see the roms path.',
        };
    }

    const mameBinary = join(config.mamePath, config.mameBinaryName);
    if (!existsSync(mameBinary)) {
        return {
            iniPath, mameIniPath, uiIniPath, pluginIniPath, romPath: null, marqueePath, flyerPath, logoPath,
            favoritesPath, genreIniPath, nplayersIniPath, windowed, pluginsPath, missingPlugins, showConfig: null,
            error: `The binary "${mameBinary}" was not found.`,
        };
    }

    try {
        const output = execFileSync(
            mameBinary,
            ['-showconfig', '-inipath', iniPath, '-homepath', iniPath],
            {cwd: iniPath, stdio: ['ignore', 'pipe', 'pipe']},
        );
        const parsed = parseMameIniFile(output.toString());
        const romPath = ensureFirstDirectory(parsed.rompath, iniPath);
        return {
            iniPath, mameIniPath, uiIniPath, pluginIniPath, romPath, marqueePath, flyerPath, logoPath,
            favoritesPath, genreIniPath, nplayersIniPath, windowed, pluginsPath, missingPlugins, showConfig: parsed,
        };
    } catch {
        return {
            iniPath, mameIniPath, uiIniPath, pluginIniPath, romPath: null, marqueePath, flyerPath, logoPath,
            favoritesPath, genreIniPath, nplayersIniPath, windowed, pluginsPath, missingPlugins, showConfig: null,
            error: 'Unable to read the mame configuration ("-showconfig" failed).',
        };
    }
}

/**
 * Same favorites.ini parsing as MameService.getRomListFromFavorites(). Duplicated for the
 * same reason as the rest of this file: avoids importing MameService.class.ts, which pulls
 * in Helpers.class.ts's @electron/remote import at module scope.
 */
function getFavoriteRomNames(favoritesPath: string): string[] {
    const regexp = new RegExp(/^(?![0-9]$)[a-z0-9]+$/, 'gm');
    const lines = readFileSync(favoritesPath, 'utf8').split('\n');
    const romNames: string[] = [];
    const seen: { [key: string]: boolean } = {};
    lines.forEach((rawLine) => {
        const line = rawLine.trim();
        if (regexp.test(line) && !seen[line]) {
            seen[line] = true;
            romNames.push(line);
        }
    });
    return romNames;
}

function extractXmlTagContent(xml: string, tagName: string): string | null {
    const match = new RegExp(`<${tagName}>([\\s\\S]*?)</${tagName}>`).exec(xml);
    return match ? match[1] : null;
}

function extractXmlAttribute(xml: string, tagName: string, attributeName: string): string | null {
    const tagMatch = new RegExp(`<${tagName}\\b[^>]*>`).exec(xml);
    if (!tagMatch) {
        return null;
    }
    const attrMatch = new RegExp(`${attributeName}="([^"]*)"`).exec(tagMatch[0]);
    return attrMatch ? attrMatch[1] : null;
}

/**
 * `.zip` filenames (extension stripped) directly inside romPath, sorted for a stable <select>
 * order. Deliberately readdirSync, not Game.findAll(): renderForm()/its call sites are all
 * synchronous, and the input-probe dropdown (see renderInputProbeCard()) only needs romName, not
 * Game's fullname.
 */
function listRomNames(romPath: string): string[] {
    try {
        return readdirSync(romPath)
            .filter(name => name.toLowerCase().endsWith('.zip'))
            .map(name => name.slice(0, -4))
            .sort((a, b) => a.localeCompare(b));
    } catch {
        return [];
    }
}

interface GameXmlInfo {
    description: string | null;
    // The name of the separate BIOS set this game needs (mame -lx's `romof` attribute on
    // <machine>), e.g. "neogeo" - null when the game is self-contained.
    biosName: string | null;
    // Names of device romsets this game needs beyond its own zip and biosName's parent set,
    // e.g. "ym2413" for pang - null when the game is self-contained.
    deviceRoms: string[];
}

/**
 * `mame -lx <romName>` lists the target <machine> first, then one <machine isdevice="yes">
 * block per device it uses (device_ref on the target machine names them by tag). Most devices
 * (cpus, screen, speaker, ...) have no <rom> children and don't need a zip of their own - only
 * ones that do (e.g. ym2413's internal instrument ROM) are actual romset dependencies, distinct
 * from biosName's parent-set relationship (e.g. puckman -> pacman).
 */
function getDeviceRomNames(xmlContent: string): string[] {
    const machineBlocks = xmlContent.match(/<machine\b[^>]*>[\s\S]*?<\/machine>/g);
    if (!machineBlocks || machineBlocks.length < 2) {
        return [];
    }
    const [targetBlock, ...deviceBlocks] = machineBlocks;
    const refNames = [...targetBlock.matchAll(/<device_ref\b[^>]*\bname="([^"]*)"/g)].map(match => match[1]);

    const hasRomsByName = new Map<string, boolean>();
    for (const block of deviceBlocks) {
        const nameMatch = /^<machine\b[^>]*\bname="([^"]*)"/.exec(block);
        if (nameMatch) {
            hasRomsByName.set(nameMatch[1], /<rom\b/.test(block));
        }
    }
    return refNames.filter(name => hasRomsByName.get(name));
}

/**
 * Same per-rom lookup as MameService.getGameInformation(), but with regex tag/attribute
 * extraction instead of DOMParser: DOMParser is a browser global available in the renderer,
 * not in this main-process server.
 */
function getGameXmlInfo(mameBinary: string, iniPath: string, romName: string): GameXmlInfo {
    try {
        const xmlContent = execFileSync(
            mameBinary,
            ['-lx', romName, '-inipath', iniPath, '-homepath', iniPath],
            {encoding: 'utf8', cwd: iniPath, stdio: ['ignore', 'pipe', 'pipe']},
        );
        return {
            description: extractXmlTagContent(xmlContent, 'description'),
            biosName: extractXmlAttribute(xmlContent, 'machine', 'romof'),
            deviceRoms: getDeviceRomNames(xmlContent),
        };
    } catch {
        return {description: null, biosName: null, deviceRoms: []};
    }
}

interface FavoriteMediaStatus {
    hasMarquee: boolean;
    hasFlyer: boolean;
    hasLogo: boolean;
}

interface FavoriteRow extends FavoriteMediaStatus {
    romName: string;
    fullname: string;
    biosName: string | null;
    deviceRoms: string[];
    // False when this rom has no entry in the favorites cache yet (added since the last "Update
    // favorites") - fullname then just falls back to romName and biosName/deviceRoms to
    // empty, rather than paying for a `mame -lx` call on every page load (see resolveFavoriteRow()).
    cached: boolean;
}

interface FavoritesInfo {
    rows: FavoriteRow[];
    error?: string;
    // ISO timestamp of the favorites cache this list's names/BIOS came from - null when the
    // cache doesn't exist yet (never refreshed). Media badges (hasMarquee/hasFlyer/hasLogo) are
    // always live, regardless of cache age - see getFavoriteMediaStatus().
    cacheUpdatedAt?: string | null;
    // One-shot flash messages after a favorite was removed (POST /favorites/delete).
    notice?: string;
    warning?: string;
}

interface FavoritesContext {
    romNames: string[];
    mameBinary: string;
    iniPath: string;
    marqueePath: string | null;
    flyerPath: string | null;
    logoPath: string | null;
}

/**
 * Every cheap (fs/config) check getFavoritesInfo used to do up front, split out on its own so a
 * caller can start streaming a response immediately after this resolves, instead of only after
 * every favorite's slow, blocking `mame -lx` lookup (see resolveFavoriteRow()) has also run.
 */
function getFavoritesContext(config: Config): FavoritesContext | {error: string} {
    const iniPath = getMameHomePath();
    const {marqueePath, flyerPath, logoPath, favoritesPath} = getMameLocations(iniPath);

    if (!favoritesPath) {
        return {error: 'No favorites yet - add some from the MAME menu (Tab in game).'};
    }

    const romNames = getFavoriteRomNames(favoritesPath);
    if (!romNames.length) {
        return {error: 'The favorites.ini file contains no favorites yet.'};
    }

    if (!config.mamePath || !config.mameBinaryName) {
        return {error: 'Configure the mame binary in the MAME tab to display the favorites\' names.'};
    }
    const mameBinary = join(config.mamePath, config.mameBinaryName);
    if (!existsSync(mameBinary)) {
        return {error: `The binary "${mameBinary}" was not found.`};
    }

    return {romNames, mameBinary, iniPath, marqueePath, flyerPath, logoPath};
}

/**
 * Cheap (fs-only, no `mame -lx`) marquee/flyer/logo presence check for one favorite - shared by
 * both the cached favorites list and resolveFavoriteRow() below, so badges are always live even
 * when the name/BIOS cache is stale.
 */
function getFavoriteMediaStatus(context: FavoritesContext, romName: string): FavoriteMediaStatus {
    const {marqueePath, flyerPath, logoPath} = context;
    return {
        hasMarquee: !!marqueePath && existsSync(join(marqueePath, romName + '.png')),
        hasFlyer: !!flyerPath && existsSync(join(flyerPath, romName + '.png')),
        hasLogo: !!logoPath && existsSync(join(logoPath, romName + '.png')),
    };
}

/**
 * Resolves a single favorite's row - the slow part (a blocking `mame -lx` process spawn per
 * call, see getGameXmlInfo()) callers should interleave with res.write() progress so a long
 * favorites list streams in instead of blocking the whole response. Only used by "Update
 * favorites" (POST /favorites/refresh) now - the normal favorites tab reads the cache this
 * populates instead (see favoriteRowFromCache()).
 */
function resolveFavoriteRow(context: FavoritesContext, romName: string): FavoriteRow {
    const {mameBinary, iniPath} = context;
    const {description, biosName, deviceRoms} = getGameXmlInfo(mameBinary, iniPath, romName);
    return {
        romName,
        fullname: description || romName,
        biosName,
        deviceRoms,
        cached: true,
        ...getFavoriteMediaStatus(context, romName),
    };
}

/**
 * Same shape as resolveFavoriteRow(), but reads fullname/biosName/deviceRoms from the favorites
 * cache (no `mame -lx` call) - falls back to the bare romName/null/empty when this rom isn't in
 * the cache yet (cached: false), same as before any refresh has ever run.
 */
function favoriteRowFromCache(context: FavoritesContext, romName: string, cache: FavoritesCache | null): FavoriteRow {
    const entry = cache?.entries[romName];
    return {
        romName,
        fullname: entry?.fullname || romName,
        biosName: entry?.biosName ?? null,
        deviceRoms: entry?.deviceRoms ?? [],
        cached: !!entry,
        ...getFavoriteMediaStatus(context, romName),
    };
}

function hasScreenScraperCredentials(config: Config): boolean {
    return !!(config.ssDevId && config.ssDevPassword && config.ssSoftName
        && config.ssUserId && config.ssUserPassword);
}

interface DownloadSummary {
    alreadyComplete: number;
    downloaded: number;
    notFound: number;
    noMedia: number;
    errors: string[];
    stoppedForQuota: boolean;
}

/**
 * Downloads the missing marquee/flyer/logo for every favorite that doesn't already have all
 * three. Never re-fetches a game that already has all of them on disk - the ScreenScraper call
 * is skipped entirely for those, to keep API usage to the minimum needed.
 */
async function downloadMissingFavoriteMedia(
    credentials: ScreenScraperCredentials,
    marqueePath: string,
    flyerPath: string,
    logoPath: string,
    rows: ({romName: string} & FavoriteMediaStatus)[],
    onProgress: (line: string) => void = () => {},
): Promise<DownloadSummary> {
    const summary: DownloadSummary = {
        alreadyComplete: 0, downloaded: 0, notFound: 0, noMedia: 0, errors: [], stoppedForQuota: false,
    };
    const client = new ScreenScraperClient(credentials);

    for (const row of rows) {
        if (row.hasMarquee && row.hasFlyer && row.hasLogo) {
            summary.alreadyComplete++;
            onProgress(`${row.romName}: already complete, skipped.`);
            continue;
        }

        const result = await client.fetchGameMedia(row.romName);

        if (result.status === 'quota-exceeded') {
            summary.stoppedForQuota = true;
            summary.errors.push(`${row.romName}: ScreenScraper quota exceeded, processing stopped.`);
            onProgress(`${row.romName}: ScreenScraper quota exceeded, processing stopped.`);
            break;
        }
        if (result.status === 'not-found') {
            summary.notFound++;
            onProgress(`${row.romName}: not found on ScreenScraper.`);
            continue;
        }
        if (result.status === 'error') {
            summary.errors.push(`${row.romName}: ${result.message}`);
            onProgress(`${row.romName}: error (${result.message}).`);
            continue;
        }

        const downloadedKinds: string[] = [];
        const failedKinds: string[] = [];
        if (!row.hasMarquee && result.media.marqueeUrl) {
            const download = await client.downloadMedia(
                result.media.marqueeUrl, join(marqueePath, row.romName + '.png'), 'marquee',
            );
            if (download.status === 'ok') {
                summary.downloaded++;
                downloadedKinds.push('marquee');
            } else {
                summary.errors.push(`${row.romName}: ${download.message}`);
                failedKinds.push('marquee');
            }
        }
        if (!row.hasFlyer && result.media.flyerUrl) {
            const download = await client.downloadMedia(
                result.media.flyerUrl, join(flyerPath, row.romName + '.png'), 'flyer',
            );
            if (download.status === 'ok') {
                summary.downloaded++;
                downloadedKinds.push('flyer');
            } else {
                summary.errors.push(`${row.romName}: ${download.message}`);
                failedKinds.push('flyer');
            }
        }
        if (!row.hasLogo && result.media.logoUrl) {
            const download = await client.downloadMedia(
                result.media.logoUrl, join(logoPath, row.romName + '.png'), 'logo',
            );
            if (download.status === 'ok') {
                summary.downloaded++;
                downloadedKinds.push('logo');
            } else {
                summary.errors.push(`${row.romName}: ${download.message}`);
                failedKinds.push('logo');
            }
        }

        if (!downloadedKinds.length && !failedKinds.length) {
            // Found on ScreenScraper, but no marquee/flyer/logo available for it (e.g. a
            // "notgame" driver entry like a BIOS/device, or media simply not uploaded yet).
            summary.noMedia++;
            onProgress(`${row.romName}: found, but no artwork available.`);
        } else {
            const parts: string[] = [];
            if (downloadedKinds.length) {
                parts.push(`${downloadedKinds.join(' and ')} downloaded`);
            }
            if (failedKinds.length) {
                parts.push(`${failedKinds.join(' and ')} failed`);
            }
            onProgress(`${row.romName}: ${parts.join(', ')}.`);
        }
    }

    return summary;
}

function escapeHtml(value: string): string {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

/**
 * Spawns `python3 scripts/import-starting-pack.py ...scriptArgs`, streaming its stdout/stderr
 * line-by-line into an already-`res.writeHead()`'d, already-headed HTML response as a live
 * progress log - shared by /import and /import/from-url, which only differ in the section title,
 * the script args/env, and what they render once the import finishes.
 *
 * Caller must have already written the page head (renderPageHead()) before calling this. On a
 * launch failure (`error` event, e.g. python3 vanishing mid-request), this writes the error
 * block itself, closes out the response (renderPageTail() + res.end()) and resolves false so the
 * caller skips its own post-import render; on a normal close, it only closes the `<section>` and
 * resolves true, leaving the rest of the page (and res.end()) to the caller.
 */
function runImportScript(
    res: Response, title: string, scriptArgs: string[], env: NodeJS.ProcessEnv,
    overall?: {index: number; total: number},
): Promise<boolean> {
    const scriptPath = join(getScriptsPath(), 'import-starting-pack.py');
    const barId = `import-progress-${++importProgressCounter}`;
    // A pack downloaded whole (--url alone) spends its first half downloading; a local file, or a
    // pack read partially (--url with --only), has no such phase.
    const hasDownload = scriptArgs.includes('--url') && !scriptArgs.includes('--only');
    res.write(`<section class="card"><h2>${title}</h2>${renderImportProgressBar(barId, hasDownload, overall)}`
        + PROGRESS_LOG_OPEN);

    return new Promise(resolve => {
        const child = spawn('python3', [scriptPath, ...scriptArgs], {env: {...env, MAUI_PROGRESS: '1'}});

        const updateBar = (call: string): void => {
            res.write(`<script>mauiImportProgress.${call}</script>`);
        };
        const writeLine = (line: string): void => {
            const progress = /^@@PROGRESS (download|import) (\d+) (\d+)$/.exec(line.trim());
            if (progress) {
                updateBar(`update(${JSON.stringify(barId)},${JSON.stringify(progress[1])},${progress[2]},${progress[3]})`);
            } else if (line.trim()) {
                res.write(`<li>${escapeHtml(line)}</li>`);
            }
        };
        // child.stdout/stderr 'data' chunks don't align to line boundaries - buffer each stream
        // separately and only flush complete lines, same as tailing a log file.
        const makeLineSplitter = (onLine: (line: string) => void) => {
            let buffer = '';
            return {
                push: (chunk: Buffer) => {
                    buffer += chunk.toString('utf8');
                    const lines = buffer.split('\n');
                    buffer = lines.pop() ?? '';
                    lines.forEach(onLine);
                },
                flush: () => {
                    if (buffer.trim()) {
                        onLine(buffer);
                    }
                },
            };
        };
        const stdoutSplitter = makeLineSplitter(writeLine);
        const stderrSplitter = makeLineSplitter(writeLine);
        child.stdout.on('data', stdoutSplitter.push);
        child.stderr.on('data', stderrSplitter.push);

        child.on('error', (error) => {
            res.write(`</ul><p class="error">${escapeHtml(`Launch failed: ${error.message}`)}</p></section>`);
            res.write(renderPageTail());
            res.end();
            resolve(false);
        });

        child.on('close', (code) => {
            stdoutSplitter.flush();
            stderrSplitter.flush();
            updateBar(`finish(${JSON.stringify(barId)},${code === 0})`);
            res.write('</ul></section>');
            resolve(true);
        });
    });
}

let importProgressCounter = 0;

/**
 * Progress bar(s) for one import run, driven by the `<script>mauiImportProgress.update(...)`
 * lines runImportScript() streams as the script reports its `@@PROGRESS` lines. Bar 1 is the
 * current pack (download, then games imported); a second, thinner one shows the whole batch when
 * several packs are imported in a row. The helper is (re)defined with each run: it is
 * idempotent, and a streamed page has no other single place to put it.
 */
function renderImportProgressBar(id: string, hasDownload: boolean, overall?: {index: number; total: number}): string {
    const overallBar = overall && overall.total > 1 ? `
        <div class="progress-label"><span>Pack ${overall.index + 1} of ${overall.total}</span></div>
        <div class="progress-track progress-track-thin"><div class="progress-fill" data-overall></div></div>
    ` : '';
    return `
        <div class="import-progress" id="${id}" data-download="${hasDownload ? '1' : '0'}"
            data-index="${overall ? overall.index : 0}" data-total="${overall ? overall.total : 1}">
            <div class="progress-label"><span data-label>Starting…</span><span data-percent></span></div>
            <div class="progress-track"><div class="progress-fill progress-indeterminate" data-fill></div></div>
            ${overallBar}
        </div>
        <script>
        window.mauiImportProgress = window.mauiImportProgress || (function () {
            function size(bytes) {
                var units = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
                var i = 0;
                while (bytes >= 1024 && i < units.length - 1) { bytes /= 1024; i++; }
                return bytes.toFixed(1) + ' ' + units[i];
            }
            function draw(root, label, fraction, overallFraction) {
                var fill = root.querySelector('[data-fill]');
                var known = fraction !== null;
                fill.classList.toggle('progress-indeterminate', !known);
                fill.style.width = known ? (fraction * 100).toFixed(1) + '%' : '';
                root.querySelector('[data-label]').textContent = label;
                root.querySelector('[data-percent]').textContent = known ? Math.round(fraction * 100) + '%' : '';
                var overall = root.querySelector('[data-overall]');
                if (overall && overallFraction !== null) { overall.style.width = (overallFraction * 100).toFixed(1) + '%'; }
            }
            return {
                update: function (id, phase, done, total) {
                    var root = document.getElementById(id);
                    if (!root) { return; }
                    var hasDownload = root.dataset.download === '1';
                    var fraction = total > 0 ? Math.min(done / total, 1) : null;
                    var label = phase === 'download'
                        ? 'Downloading' + (total > 0 ? ' — ' + size(done) + ' / ' + size(total) : ' — ' + size(done))
                        : 'Importing games — ' + done + ' / ' + total;
                    // Download = first half of a pack's own progress, import = second half.
                    var packFraction = fraction === null ? null
                        : hasDownload ? (phase === 'download' ? fraction / 2 : 0.5 + fraction / 2) : fraction;
                    var index = Number(root.dataset.index), count = Number(root.dataset.total);
                    draw(root, label, fraction, packFraction === null ? null : (index + packFraction) / count);
                },
                finish: function (id, ok) {
                    var root = document.getElementById(id);
                    if (!root) { return; }
                    var fill = root.querySelector('[data-fill]');
                    fill.classList.remove('progress-indeterminate');
                    fill.style.width = '100%';
                    fill.classList.add(ok ? 'progress-done' : 'progress-failed');
                    root.querySelector('[data-label]').textContent = ok ? 'Done' : 'Finished with errors — see the log below';
                    root.querySelector('[data-percent]').textContent = '';
                    var overall = root.querySelector('[data-overall]');
                    var index = Number(root.dataset.index), count = Number(root.dataset.total);
                    if (overall) { overall.style.width = ((index + 1) / count * 100).toFixed(1) + '%'; }
                }
            };
        })();
        </script>
    `;
}

function renderPage(body: string, active: Tab = 'mame', authenticated: boolean = true, hasSubtabs: boolean = false): string {
    return renderPageHead(active, authenticated, hasSubtabs) + body + renderPageTail();
}

interface Subsection {
    // Short slug, also used as the URL hash so a subtab is directly linkable/bookmarkable and
    // survives a page reload (e.g. after a form POST re-renders the same tab).
    id: string;
    // Kept short - shown as the subtab's own label. The section's existing <h2> (inside html)
    // stays as the longer, fully descriptive heading; nothing about it changes.
    label: string;
    // Complete `<section class="card">...</section>` markup, exactly as a bare renderXCard()
    // call already produces - this just groups and gates visibility of what was previously
    // concatenated straight into the page body.
    html: string;
}

/**
 * Wraps 2+ cards for one primary tab behind a secondary "subtabs" row instead of one long
 * vertically-stacked page - one card's <h2> per subtab, but reachable through a short label
 * instead of scrolling. Client-side only (renderPageTail()'s script shows/hides
 * .subtab-panel elements; every panel is still fully rendered server-side, nothing is fetched
 * on demand) - a full page reload (e.g. after a form POST) still works exactly as before, it
 * just needs the right panel picked back out on load (see that script: URL hash first, then
 * this call's own defaultSectionId, then whichever panel has a message to show).
 * A single section is rendered bare, with no subtabs nav at all - nothing to switch between.
 *
 * defaultSectionId: which section a response is "about", set by the caller from whichever of
 * its own message params is actually filled in (see renderForm()'s own defaultSubtab logic for
 * the reasoning) - not inferred client-side from scanning for .flash content. A section with a
 * standing warning unrelated to what was just submitted (missing plugins, no python3...) can
 * carry a .flash of its own at the same time; without this, whichever of those happens to come
 * first in `sections` always wins over the section the just-submitted form actually belongs to.
 */
function renderSubtabbedPage(
    active: Tab, sections: Subsection[], authenticated: boolean = true, defaultSectionId?: string,
): string {
    if (sections.length <= 1) {
        return renderPage(sections.map(section => section.html).join(''), active, authenticated);
    }
    const nav = `
        <nav class="subtabs" data-default-subtab="${escapeHtml(defaultSectionId || '')}">
            ${sections.map(section => `
                <a href="#${escapeHtml(section.id)}" class="subtab-link" data-subtab="${escapeHtml(section.id)}">
                    ${escapeHtml(section.label)}
                </a>
            `).join('')}
        </nav>
    `;
    const panels = sections.map(section => `
        <div class="subtab-panel" data-subtab-panel="${escapeHtml(section.id)}">${section.html}</div>
    `).join('');
    return renderPage(nav + panels, active, authenticated, true);
}

/**
 * Head/style/header/nav prelude, split out from renderPage() so a route can stream a page in
 * chunks with res.write() (progress feedback for a long-running action) instead of building
 * the whole HTML string before sending anything.
 */
/**
 * Opening tag of a streamed progress log (a `<ul class="progress-log">` that gets one `<li>` per
 * line as the response is written - imports, favorites refresh, media download, self-update).
 * The list is a fixed-height scrollable box (see .progress-log), and a browser never scrolls
 * such a box by itself as content is appended: once the lines overflow it, the box just sat on
 * its first lines while the newest ones - the actual progress, e.g. "Downloaded: 84 MB" -
 * piled up out of sight below, so the log seemed frozen. The inline script keeps it pinned to the
 * bottom as lines arrive; a <script> is valid directly inside a <ul>.
 */
const PROGRESS_LOG_OPEN = '<ul class="progress-log"><script>(function () {'
    + 'var log = document.currentScript.parentNode;'
    + 'new MutationObserver(function () { log.scrollTop = log.scrollHeight; }).observe(log, {childList: true});'
    + '})();</script>';

function renderPageHead(active: Tab = 'mame', authenticated: boolean = true, hasSubtabs: boolean = false): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <title>mame-awesome-ui - Configuration</title>
    <style>
        html {
            min-height: 100%;
            background-color: #000000;
            background-image: url('/background.jpg');
            background-size: cover;
            background-repeat: repeat;
            background-position: 0 0;
        }
        body {
            color: #ffffff;
            font-family: sans-serif;
            box-sizing: border-box;
            /* Grows with the viewport (tables like Users/Favorites need the room) instead of
               a fixed 560px that forced .table-wrap's horizontal scrollbar on every page,
               but stays capped so text stays readable on wide desktop windows. */
            max-width: min(1100px, 96vw);
            margin: 0 auto;
            padding: 24px 16px 48px;
        }
        header {
            padding: 16px 0 24px;
            text-align: center;
        }
        header h1 {
            margin: 0;
            font-size: 1.4em;
        }
        .app-version {
            position: fixed;
            top: 8px;
            right: 12px;
            z-index: 10;
            color: #ff4d4d;
            font-size: 0.8em;
            font-weight: bold;
        }
        .tabs {
            display: flex;
            justify-content: center;
            gap: 4px;
            margin-top: 16px;
            border-bottom: 1px solid #333333;
        }
        .tabs a {
            display: inline-block;
            padding: 8px 16px;
            color: #aaaaaa;
            text-decoration: none;
            border-bottom: 2px solid transparent;
            transition: color 0.15s ease, border-color 0.15s ease;
        }
        .tabs a:hover {
            color: #ffffff;
        }
        .tabs a.active {
            color: #ffffff;
            border-bottom-color: #8ab4f8;
        }
        .card {
            background-color: rgba(0, 0, 0, 0.55);
            border-radius: 8px;
            padding: 24px 16px;
            margin-bottom: 24px;
        }
        .card h2 {
            margin-top: 0;
            font-size: 1.1em;
            border-bottom: 1px solid #333333;
            padding-bottom: 8px;
        }
        a {
            color: #8ab4f8;
        }
        label {
            display: block;
            margin-top: 16px;
        }
        input, select {
            width: 100%;
            box-sizing: border-box;
            padding: 8px;
            margin-top: 4px;
            transition: outline-color 0.15s ease;
        }
        input:focus, select:focus {
            outline: 2px solid #8ab4f8;
            outline-offset: -1px;
        }
        button {
            padding: 8px 16px;
            color: #000000;
            background-color: #ffffff;
            border: none;
            border-radius: 4px;
            cursor: pointer;
            transition: background-color 0.15s ease, opacity 0.15s ease;
        }
        button:hover:not(:disabled) {
            background-color: #dddddd;
        }
        button:disabled {
            opacity: 0.5;
            cursor: not-allowed;
        }
        form > button[type="submit"]:last-child {
            margin-top: 24px;
        }
        .error, .info {
            padding: 10px 14px;
            margin: 12px 0 0;
            border-radius: 6px;
            border-left: 3px solid currentColor;
        }
        .error {
            color: #ff6b6b;
            background-color: rgba(255, 107, 107, 0.12);
        }
        .info {
            color: #8ab4f8;
            background-color: rgba(138, 180, 248, 0.12);
        }
        /* Info line with an action at its far end (favorites: cache date + "Update favorites").
           The button selector out-ranks the generic "form > button:last-child" 24px top margin. */
        .status-row {
            display: flex;
            flex-wrap: wrap;
            align-items: center;
            justify-content: space-between;
            gap: 8px 16px;
        }
        .status-row form {
            margin: 0;
        }
        .status-row form > button[type="submit"]:last-child {
            margin-top: 0;
        }
        .path-row {
            display: flex;
            gap: 8px;
            margin-top: 4px;
        }
        .path-row input {
            margin-top: 0;
        }
        .button-row {
            display: flex;
            flex-wrap: wrap;
            gap: 8px;
            margin-top: 24px;
        }
        .launch-button {
            display: inline-flex;
            align-items: center;
            gap: 8px;
        }
        .launch-logo {
            height: 20px;
            width: auto;
        }
        .checkbox-row {
            display: flex;
            align-items: flex-start;
            gap: 8px;
            margin-top: 16px;
        }
        .checkbox-row input {
            width: auto;
            margin-top: 3px;
        }
        /* Wraps everything after the checkbox in one flex item (an element like <code> inside
           otherwise-bare text would each become their own anonymous flex item, and the first
           text run wraps within its own narrowed box instead of flowing as one paragraph across
           the row - see the "Delete the whole ... directory" row this was written for). */
        .checkbox-row > span {
            flex: 1 1 auto;
            min-width: 0;
        }
        .checkbox-row-detail {
            display: block;
            margin-top: 2px;
            color: #aaaaaa;
            font-size: 0.9em;
        }
        .current-path {
            font-family: monospace;
            word-break: break-all;
            background-color: #111111;
            padding: 8px;
        }
        .info-field {
            margin-top: 12px;
        }
        .info-field dt {
            font-size: 0.85em;
            color: #aaaaaa;
        }
        .info-field dd {
            margin: 4px 0 0;
            font-family: monospace;
            word-break: break-all;
            background-color: #111111;
            padding: 8px;
        }
        .info-field dd ul {
            margin: 0;
            padding-left: 20px;
        }
        .button-link {
            display: inline-block;
            padding: 8px 16px;
            background-color: #ffffff;
            color: #000000;
            text-decoration: none;
            border-radius: 4px;
            transition: background-color 0.15s ease;
        }
        .button-link:hover {
            background-color: #dddddd;
        }
        .browse-list {
            list-style: none;
            padding: 0;
            margin: 16px 0;
            max-height: 400px;
            overflow-y: auto;
        }
        .browse-list li {
            padding: 6px 0;
            border-bottom: 1px solid #222222;
        }
        .table-wrap {
            overflow-x: auto;
        }
        table.favorites-table {
            width: 100%;
            border-collapse: collapse;
        }
        table.favorites-table th,
        table.favorites-table td {
            text-align: left;
            padding: 6px 8px;
            border-bottom: 1px solid #222222;
            white-space: nowrap;
        }
        table.favorites-table th.center,
        table.favorites-table td.center {
            text-align: center;
        }
        .badge-yes {
            color: #6bff8a;
        }
        .badge-no {
            color: #ff6b6b;
        }
        .row-actions {
            display: inline-flex;
            gap: 8px;
        }
        .asset-icons {
            display: inline-flex;
            gap: 8px;
            vertical-align: middle;
        }
        .asset-icon {
            display: inline-flex;
            cursor: help;
        }
        /* Icon-only submit button (favorites Remove/Restore): compact, outlined in its own color
           instead of the plain white button. The extra selector parts beat the generic
           "form > button[type=submit]:last-child" 24px top margin above, which would otherwise
           push it out of its table row's alignment. */
        form > button.icon-button[type="submit"]:last-child {
            display: inline-flex;
            padding: 5px;
            margin-top: 0;
            color: #ff6b6b;
            background-color: transparent;
            border: 1px solid currentColor;
        }
        form > button.icon-button.icon-button-ok[type="submit"]:last-child {
            color: #6bff8a;
        }
        form > button.icon-button.icon-button-warn[type="submit"]:last-child {
            color: #ffd166;
        }
        button.icon-button:hover:not(:disabled) {
            background-color: rgba(255, 255, 255, 0.12);
        }
        .avatar-thumb {
            display: block;
            width: 36px;
            height: 36px;
            object-fit: cover;
            border-radius: 4px;
        }
        .avatar-placeholder {
            display: flex;
            align-items: center;
            justify-content: center;
            background: #222222;
            color: #888888;
            font-size: 18px;
        }
        .avatar-upload {
            display: inline-block;
            position: relative;
            cursor: pointer;
            border-radius: 4px;
        }
        .avatar-upload:hover .avatar-thumb {
            opacity: 0.6;
        }
        .avatar-upload input[type="file"] {
            position: absolute;
            inset: 0;
            width: 100%;
            height: 100%;
            opacity: 0;
            cursor: pointer;
        }
        .info-icon {
            display: inline-flex;
            vertical-align: middle;
            color: #8ab4f8;
            cursor: help;
        }
        .found-icon {
            display: inline-flex;
            vertical-align: middle;
            flex-shrink: 0;
            margin-right: 6px;
        }
        .found-yes {
            color: #6bff8a;
        }
        .found-no {
            color: #ff6b6b;
        }
        .disk-bar-track {
            display: flex;
            height: 22px;
            margin: 8px 0;
            background-color: #111111;
            border: 1px solid #333333;
            border-radius: 11px;
            overflow: hidden;
        }
        .disk-bar-track.disk-bar-overflow {
            border-color: #ff6b6b;
            box-shadow: 0 0 0 1px #ff6b6b;
        }
        .disk-bar-used {
            background-color: #555555;
        }
        /* Roms already on disk: lighter neutral grey, so the coloured segments stay the "new" part. */
        .disk-bar-roms {
            background-color: #b5bcc4;
        }
        /* One coloured segment per ticked pack (background set inline); flex-shrink 0 so a
           selection larger than the disk overflows (clipped, red outline) instead of squeezing. */
        .disk-bar-seg {
            flex-shrink: 0;
            min-width: 3px;
            border-left: 1px solid #000000;
            transition: width 0.25s ease-out;
        }
        .disk-zoomed .disk-bar-track > .disk-bar-used,
        .disk-zoomed .disk-bar-track > .disk-bar-roms,
        .disk-zoomed .disk-legend-static {
            display: none;
        }
        .disk-zoom-note {
            margin: 0 0 4px;
            font-size: 0.85em;
            color: #8ab4f8;
        }
        .disk-legend {
            display: flex;
            flex-wrap: wrap;
            gap: 4px 16px;
            list-style: none;
            padding: 0;
            margin: 0 0 12px;
            font-size: 0.85em;
            color: #cccccc;
        }
        .pack-owned {
            opacity: 0.55;
        }
        /* Aligned under the pack name: checkbox (13px + gap) + swatch (12px + margins). */
        .pack-details {
            margin: 4px 0 0 44px;
            font-size: 0.9em;
        }
        .pack-details summary {
            cursor: pointer;
            color: #8ab4f8;
        }
        .category-row {
            border-top: 1px solid #333;
        }
        .category-row summary {
            display: flex;
            align-items: center;
            gap: 12px;
            padding: 6px 0;
            cursor: pointer;
        }
        .category-icon {
            width: 40px;
            height: 40px;
            flex: none;
        }
        .category-name {
            flex: 1;
        }
        .category-count {
            color: #999;
            font-size: 0.9em;
        }
        .category-games {
            list-style: none;
            margin: 0 0 8px 52px;
            padding: 0;
            max-height: 320px;
            overflow-y: auto;
            font-size: 0.9em;
        }
        .category-games li {
            padding: 2px 0;
        }
        /* Name, rom name and year · studio · players on one line (wrapping only when too long);
           .checkbox-row-detail is display: block by default. */
        .category-games .checkbox-row-detail {
            display: inline;
            margin: 0 0 0 8px;
        }
        .category-game-meta {
            margin-left: 8px;
            color: #999;
            font-size: 0.9em;
        }
        .category-game-meta::before {
            content: '— ';
        }
        .pack-games {
            list-style: none;
            padding: 0;
            margin: 6px 0 0;
            max-height: 240px;
            overflow-y: auto;
        }
        .pack-game {
            display: flex;
            gap: 8px;
            padding: 2px 0;
        }
        /* Overrides the page-wide label/input styles (block, full width, top margin). */
        /* display: flex above would beat the UA rule for [hidden] (search filter). */
        .pack-game[hidden], .pack-row[hidden] {
            display: none;
        }
        .pack-search {
            margin: 16px 0 0;
        }
        .pack-search-count {
            margin: 8px 0 0;
        }
        .pack-game-label {
            display: flex;
            align-items: flex-start;
            gap: 8px;
            margin: 0;
            cursor: pointer;
        }
        .pack-game-label input {
            flex: 0 0 auto;
            width: auto;
            margin: 3px 0 0;
        }
        .pack-game-mark {
            flex: 0 0 14px;
            text-align: center;
            color: #aaaaaa;
        }
        .pack-game-installed .pack-game-mark {
            color: #6bff8a;
        }
        .pack-game-highlight {
            color: #f8eb48;
        }
        .pack-game-highlight .pack-game-mark {
            color: #f8eb48;
        }
        .pack-status {
            display: block;
            margin-top: 2px;
            font-size: 0.85em;
            color: #aaaaaa;
        }
        .pack-status-owned {
            color: #6bff8a;
        }
        .pack-status-update {
            color: #f8eb48;
        }
        .pack-swatch {
            display: inline-block;
            flex: 0 0 auto;
            width: 12px;
            height: 12px;
            margin: 3px 6px 0 0;
            border-radius: 2px;
            vertical-align: baseline;
        }
        /* Out-ranks ".checkbox-row > span" (flex: 1 1 auto), which would stretch the swatch. */
        .checkbox-row > .pack-swatch {
            flex: 0 0 12px;
        }
        .disk-legend .pack-swatch {
            margin-top: 0;
            vertical-align: -1px;
        }
        .progress-log {
            list-style: none;
            padding: 0;
            margin: 16px 0;
            max-height: 320px;
            overflow-y: auto;
            font-family: monospace;
            font-size: 0.9em;
        }
        .import-progress {
            margin: 12px 0;
        }
        .progress-label {
            display: flex;
            justify-content: space-between;
            gap: 12px;
            margin: 8px 0 4px;
            font-size: 0.9em;
            color: #cccccc;
        }
        .progress-track {
            height: 18px;
            background-color: #111111;
            border: 1px solid #333333;
            border-radius: 9px;
            overflow: hidden;
        }
        .progress-track-thin {
            height: 8px;
            border-radius: 4px;
        }
        .progress-fill {
            height: 100%;
            width: 0;
            background-color: #8ab4f8;
            transition: width 0.25s ease-out;
        }
        .progress-fill.progress-done {
            background-color: #6bff8a;
        }
        .progress-fill.progress-failed {
            background-color: #ff6b6b;
        }
        /* Total unknown (server sent no Content-Length): a sliding stripe instead of a bar that
           would sit at 0% and look frozen. */
        .progress-fill.progress-indeterminate {
            width: 100%;
            background-image: linear-gradient(90deg, transparent 0%, rgba(255, 255, 255, 0.35) 50%, transparent 100%);
            background-size: 40% 100%;
            background-repeat: no-repeat;
            animation: progress-slide 1.2s linear infinite;
        }
        @keyframes progress-slide {
            0% { background-position: -40% 0; }
            100% { background-position: 140% 0; }
        }
        .progress-log li {
            padding: 4px 0;
            border-bottom: 1px solid #222222;
        }
        .progress-log li:last-child {
            animation: pulse 1s ease-in-out infinite;
        }
        @keyframes pulse {
            0%, 100% { opacity: 1; }
            50% { opacity: 0.4; }
        }
        /* Present once a page has subtabs (see renderSubtabbedPage()) - the primary nav steps
           back (smaller, dimmed except the active tab) so the subtabs row below reads as the
           primary navigation for the page actually being looked at, without hiding the way
           back to the other top-level tabs. */
        .tabs.compact a {
            padding: 6px 12px;
            font-size: 0.85em;
            opacity: 0.55;
        }
        .tabs.compact a.active {
            opacity: 1;
        }
        .subtabs {
            display: flex;
            flex-wrap: wrap;
            gap: 4px;
            margin: 4px 0 20px;
            border-bottom: 1px solid #333333;
            animation: subtabs-slide-in 0.2s ease-out;
        }
        @keyframes subtabs-slide-in {
            from { opacity: 0; transform: translateX(-16px); }
            to { opacity: 1; transform: translateX(0); }
        }
        .subtabs a {
            display: inline-block;
            padding: 8px 16px;
            color: #aaaaaa;
            text-decoration: none;
            border-bottom: 2px solid transparent;
            transition: color 0.15s ease, border-color 0.15s ease;
        }
        .subtabs a:hover {
            color: #ffffff;
        }
        .subtabs a.active {
            color: #8ab4f8;
            border-bottom-color: #8ab4f8;
        }
        .subtab-panel {
            display: none;
        }
        .subtab-panel.active {
            display: block;
        }
    </style>
</head>
<body>
    <div class="app-version" title="Running version">v${escapeHtml(getRunningVersion())}</div>
    <header>
        <h1>mame-awesome-ui</h1>
        ${authenticated ? `<nav class="tabs${hasSubtabs ? ' compact' : ''}">
            <a href="/" class="${active === 'mame' ? 'active' : ''}">MAME</a>
            <a href="/favorites" class="${active === 'favorites' ? 'active' : ''}">Games</a>
            <a href="/users" class="${active === 'users' ? 'active' : ''}">Players</a>
            <a href="/screenscraper" class="${active === 'screenscraper' ? 'active' : ''}">ScreenScraper</a>
            <a href="/maui" class="${active === 'maui' ? 'active' : ''}">MAUI</a>
            <a href="/account" class="${active === 'account' ? 'active' : ''}">My account</a>
        </nav>` : ''}
    </header>
    `;
}

function renderPageTail(): string {
    return `
    <script>
        // Every action here is a plain form POST/GET (full page navigation, no AJAX) - the only
        // feedback the browser gives on its own during that navigation is the tab's spinner,
        // easy to miss. Disable + relabel whichever button actually triggered the submission
        // (event.submitter, not just "the first submit button in the form" - several forms have
        // more than one, e.g. formaction-overriding browse buttons) so a click always visibly
        // registers, even before the new page has finished loading. No need to re-enable it: the
        // navigation this triggers replaces the whole DOM (or, for a confirm() dialog the user
        // cancels, defaultPrevented is set below and this is skipped entirely).
        //
        // The mutation itself is deferred one tick (setTimeout(fn, 0)) instead of applied
        // synchronously in this handler: Chrome submits a form on Enter by internally
        // simulating a click on its default button, and disabling that same button
        // synchronously from within the 'submit' event it's still in the middle of dispatching
        // aborts that in-flight click - the submission silently never happens. A real pointer
        // click isn't affected (its own default action already committed before 'submit'
        // fires), so this broke keyboard-only ("press Enter") submission specifically, while
        // clicking the button kept working - reported against exactly this symptom on the
        // login page. Deferring lets the browser finish submitting first either way.
        document.addEventListener('submit', function (event) {
            if (event.defaultPrevented) {
                return;
            }
            var button = event.submitter;
            if (button && button.tagName === 'BUTTON' && !button.disabled) {
                setTimeout(function () {
                    // An icon-only button has no text to relabel (assigning textContent would
                    // replace its <svg> with a bare "…") - just disabling it is feedback enough.
                    if (!button.classList.contains('icon-button')) {
                        button.textContent = button.textContent + '…';
                    }
                    button.disabled = true;
                }, 0);
            }
        });

        // Subtabs (see renderSubtabbedPage()): every panel is already in the DOM, server-
        // rendered - this only shows/hides which one is visible, no fetch involved. Picks, in
        // order: the URL hash (so a subtab is linkable and survives a reload), else the section
        // the server says this response is about (data-default-subtab, set from whichever of
        // renderForm()'s own message params is actually filled in for this request - not every
        // section with a .flash: a standing warning elsewhere, e.g. "plugin.ini incomplete" or
        // "python3 not found", also carries one and would otherwise wrongly outrank the
        // section a just-submitted form actually belongs to, since it's earlier in the list),
        // else whichever panel has a .flash message anyway (only reached when the server didn't
        // say - e.g. an unrelated standing warning on first load), else the first panel.
        (function () {
            var panels = document.querySelectorAll('.subtab-panel');
            if (!panels.length) {
                return;
            }
            var links = document.querySelectorAll('.subtabs a');
            function activate(id) {
                panels.forEach(function (panel) {
                    panel.classList.toggle('active', panel.dataset.subtabPanel === id);
                });
                links.forEach(function (link) {
                    link.classList.toggle('active', link.dataset.subtab === id);
                });
            }
            links.forEach(function (link) {
                link.addEventListener('click', function (event) {
                    event.preventDefault();
                    activate(link.dataset.subtab);
                    history.replaceState(null, '', '#' + link.dataset.subtab);
                });
            });
            var hashId = location.hash.replace('#', '');
            var initial = hashId && document.querySelector(
                '.subtab-panel[data-subtab-panel="' + hashId.replace(/"/g, '') + '"]',
            ) ? hashId : null;
            var nav = document.querySelector('.subtabs');
            var defaultSubtab = nav ? nav.dataset.defaultSubtab : '';
            if (!initial && defaultSubtab) {
                initial = defaultSubtab;
            }
            if (!initial) {
                panels.forEach(function (panel) {
                    if (!initial && panel.querySelector('.flash')) {
                        initial = panel.dataset.subtabPanel;
                    }
                });
            }
            activate(initial || panels[0].dataset.subtabPanel);
        })();
    </script>
</body>
</html>`;
}

function renderLoginPage(error?: string): string {
    return renderPage(`
        <section class="card">
            <h2>Sign in</h2>
            ${error ? `<p class="error flash">${escapeHtml(error)}</p>` : ''}
            <!-- Deliberately no "required" here: with two fields, pressing Enter in one while
                 the other is still empty triggers the browser's native validation instead of
                 submitting - easy to miss (the message lands on the other, unfocused field),
                 and looks like "Enter does nothing". /login already handles a blank/wrong
                 username or password gracefully (401 + "Incorrect username or password
                 incorrect."), so letting the browser send an incomplete submission and having
                 the server reject it is simpler than fighting native validation here. -->
            <form method="post" action="/login">
                <label for="username">Username</label>
                <input type="text" id="username" name="username" autofocus>
                <label for="password">Password</label>
                <input type="password" id="password" name="password">
                <button type="submit">Sign in</button>
            </form>
        </section>
    `, 'mame', false);
}

function renderAccountPage(username: string, role: string, error?: string, info?: string): string {
    return renderPage(`
        <section class="card">
            <h2>My account</h2>
            <p>Signed in as <strong>${escapeHtml(username)}</strong> (${escapeHtml(role)}).</p>
            ${error ? `<p class="error flash">${escapeHtml(error)}</p>` : ''}
            ${info ? `<p class="info flash">${escapeHtml(info)}</p>` : ''}
            <form method="post" action="/account/password">
                <label for="currentPassword">Current password</label>
                <input type="password" id="currentPassword" name="currentPassword" required>
                <label for="newPassword">New password</label>
                <input type="password" id="newPassword" name="newPassword" required minlength="4">
                <label for="confirmPassword">Confirm the new password</label>
                <input type="password" id="confirmPassword" name="confirmPassword" required minlength="4">
                <button type="submit">Change password</button>
            </form>
        </section>
        <section class="card">
            <form method="post" action="/logout">
                <button type="submit">Sign out</button>
            </form>
        </section>
    `, 'account');
}

interface ConfigFormValues {
    mamePath: string;
}

function renderConfigCard(values: ConfigFormValues, isAdmin: boolean, error?: string, info?: string): string {
    return `
        <section class="card">
            <h2>Configuration</h2>
            ${error ? `<p class="error flash">${escapeHtml(error)}</p>` : ''}
            ${info ? `<p class="info flash">${escapeHtml(info)}</p>` : ''}
            <form method="post" action="/save" novalidate>
                <label for="mamePath">Folder containing the mame binary</label>
                <div class="path-row">
                    <input type="text" id="mamePath" name="mamePath" value="${escapeHtml(values.mamePath)}">
                    <button type="submit" name="target" value="mamePath" formaction="/browse" formmethod="get">Browse</button>
                </div>
                <div class="button-row">
                    <button type="submit">Save</button>
                    ${isAdmin ? `<button type="submit" formaction="/launch" formmethod="post" class="launch-button">
                        <img src="/mame-logo.svg" alt="" class="launch-logo">
                        Launch mame
                    </button>` : ''}
                </div>
            </form>
        </section>
    `;
}

/**
 * Green check / red cross next to each MAME information field below, so a missing path/file
 * is visible at a glance instead of only readable from the "Not available"/"Not found" text
 * next to it (kept as well, for screen readers and anyone not distinguishing the colors).
 */
function renderFoundIcon(found: boolean): string {
    return found
        ? `<span class="found-icon found-yes" title="Found" aria-hidden="true">
            <svg width="14" height="14" viewBox="0 0 16 16">
                <path d="M3 8.5 L6.5 12 L13 4" fill="none" stroke="currentColor" stroke-width="2"
                    stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
        </span>`
        : `<span class="found-icon found-no" title="Not found" aria-hidden="true">
            <svg width="14" height="14" viewBox="0 0 16 16">
                <path d="M4 4 L12 12 M12 4 L4 12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
            </svg>
        </span>`;
}

function renderMameInfoCard(mameInfo: MameInfo, info?: string): string {
    // mameInfo.error means the binary isn't configured yet, or -showconfig failed against it -
    // every field/form below is resolved from that same -showconfig/ui.ini read, so none of it
    // is meaningful (or in some cases even present) until the binary's set and validated.
    if (mameInfo.error) {
        return `
            <section class="card">
                <h2>MAME information</h2>
                <p class="error flash">${escapeHtml(mameInfo.error)}</p>
            </section>
        `;
    }
    return `
        <section class="card">
            <h2>MAME information</h2>
            ${info ? `<p class="info flash">${escapeHtml(info)}</p>` : ''}
            <dl>
                <div class="info-field">
                    <dt>MAME home folder (ini, cfg, nvram, snapshots...)</dt>
                    <dd>${renderFoundIcon(existsSync(mameInfo.iniPath))}${escapeHtml(mameInfo.iniPath)}</dd>
                </div>
                <div class="info-field">
                    <dt>mame.ini file</dt>
                    <dd>${renderFoundIcon(existsSync(mameInfo.mameIniPath))}${escapeHtml(mameInfo.mameIniPath)}</dd>
                </div>
                <div class="info-field">
                    <dt>ui.ini file</dt>
                    <dd>${renderFoundIcon(existsSync(mameInfo.uiIniPath))}${escapeHtml(mameInfo.uiIniPath)}</dd>
                </div>
                <div class="info-field">
                    <dt>plugin.ini file</dt>
                    <dd>${renderFoundIcon(existsSync(mameInfo.pluginIniPath))}${escapeHtml(mameInfo.pluginIniPath)}</dd>
                </div>
                <div class="info-field">
                    <dt>Roms folder (rompath)</dt>
                    <dd>${renderFoundIcon(!!mameInfo.romPath)}${mameInfo.romPath
                        ? escapeHtml(mameInfo.romPath) : '<em>Not available</em>'}</dd>
                </div>
                <div class="info-field">
                    <dt>Marquees folder (marquees_directory)</dt>
                    <dd>${renderFoundIcon(!!mameInfo.marqueePath)}${mameInfo.marqueePath
                        ? escapeHtml(mameInfo.marqueePath) : '<em>Not available</em>'}</dd>
                </div>
                <div class="info-field">
                    <dt>Flyers folder (flyers_directory)</dt>
                    <dd>${renderFoundIcon(!!mameInfo.flyerPath)}${mameInfo.flyerPath
                        ? escapeHtml(mameInfo.flyerPath) : '<em>Not available</em>'}</dd>
                </div>
                <div class="info-field">
                    <dt>Logos folder (logos_directory)</dt>
                    <dd>${renderFoundIcon(!!mameInfo.logoPath)}${mameInfo.logoPath
                        ? escapeHtml(mameInfo.logoPath) : '<em>Not available</em>'}</dd>
                </div>
                <div class="info-field">
                    <dt>Favorites file (favorites.ini)</dt>
                    <dd>${renderFoundIcon(!!mameInfo.favoritesPath)}${mameInfo.favoritesPath
                        ? escapeHtml(mameInfo.favoritesPath)
                        : '<em>No favorites yet — add some from the MAME menu (Tab in game).</em>'}</dd>
                </div>
                <div class="info-field">
                    <dt>Genres file (genre.ini, categorypath)</dt>
                    <dd>${renderFoundIcon(!!mameInfo.genreIniPath)}${mameInfo.genreIniPath
                        ? escapeHtml(mameInfo.genreIniPath)
                        : '<em>Not found — import a starting pack (Import tab) to '
                            + 'install it at the path given by categorypath in ui.ini.</em>'}</dd>
                </div>
                <div class="info-field">
                    <dt>Player count file (Multiplayer.ini, categorypath)</dt>
                    <dd>${renderFoundIcon(!!mameInfo.nplayersIniPath)}${mameInfo.nplayersIniPath
                        ? escapeHtml(mameInfo.nplayersIniPath)
                        : '<em>Not found — import a starting pack (Import tab) to '
                            + 'install it at the path given by categorypath in ui.ini.</em>'}</dd>
                </div>
            </dl>
            <form method="post" action="/mame-options/save">
                <label for="pluginsPath">MAME plugins folder (pluginspath)</label>
                <div class="path-row">
                    <input type="text" id="pluginsPath" name="pluginsPath" value="${escapeHtml(mameInfo.pluginsPath || '')}">
                    <button type="submit" name="target" value="pluginsPath" formaction="/browse" formmethod="get">Browse</button>
                </div>
                <label class="checkbox-row">
                    <input type="checkbox" name="windowed" ${mameInfo.windowed ? 'checked' : ''}>
                    Launch MAME in windowed mode (instead of fullscreen) - edits mame.ini
                </label>
                <button type="submit">Save</button>
            </form>
            ${mameInfo.missingPlugins.length ? `
                <form method="post" action="/mame-options/repair-plugins">
                    <p class="error flash">plugin.ini is incomplete: ${mameInfo.missingPlugins.length} plugin(s)
                    found in the plugins folder but missing from plugin.ini
                    (${escapeHtml(mameInfo.missingPlugins.join(', '))}).</p>
                    <button type="submit">Repair plugin.ini (add the missing plugins)</button>
                </form>
            ` : ''}
        </section>
    `;
}

/**
 * Directory mame's hiscore plugin writes .hi files into (see HiscoreService.class.ts, which
 * symlinks iniPath/hi -> iniPath/hiscore since mame-hi-extractor hardcodes reading from "hi").
 * Duplicated here rather than imported for the same @electron/remote reason as the rest of this
 * file's helpers.
 */
function getHiscorePath(iniPath: string): string {
    return join(iniPath, 'hiscore');
}

/**
 * Danger zone for MAME's own data (hiscores, roms/media - everything under mameInfo.iniPath and
 * the game media directories). Rendered on the "mame" tab, next to the MAME info this data
 * belongs to. Kept separate from renderMauiDangerZoneCard() below (mame-awesome-ui's own
 * config/database, on the "maui" tab) so each zone only ever deletes what its own tab is about.
 */
function renderMameDangerZoneCard(mameInfo: MameInfo, info?: string): string {
    // No apostrophes/accents in the JS string literals built in onsubmit/onchange below (same
    // pattern the user-delete confirm() already used): they're embedded in single-quoted JS
    // strings inside an HTML attribute, so keeping them plain ASCII avoids any escaping headache.
    return `
        <section class="card">
            <h2>Danger zone</h2>
            <p class="error">Targeted, irreversible deletions of MAME's own data. Each checkbox
            acts independently of the others - tick what you want to delete, then submit.
            Deleting the roms/media also deletes the roms themselves, not just the artwork.</p>
            ${info ? `<p class="info flash">${escapeHtml(info)}</p>` : ''}
            <form method="post" action="/reset" onsubmit="
                var items = [];
                if (this.deleteMameHome.checked) {
                    items.push('the whole .mame directory and its content (mame.ini/ui.ini configuration, roms, media, hiscores, cfg, nvram, snapshots...)');
                } else {
                    if (this.deleteHiscores.checked) items.push('the hiscores');
                    if (this.deleteGamesMedia.checked) items.push('the games roms and media (roms, marquees, flyers, logos)');
                    if (this.deleteFavorites.checked) items.push('the favorites file (favorites.ini)');
                }
                if (!items.length) { return true; }
                return confirm('Permanently delete ' + items.join(', ') + '? This cannot be undone.');
            ">
                <input type="hidden" name="zone" value="mame">
                <label class="checkbox-row">
                    <input type="checkbox" name="deleteHiscores">
                    <span>Delete the hiscores (<code>${escapeHtml(getHiscorePath(mameInfo.iniPath))}</code>)</span>
                </label>
                <label class="checkbox-row">
                    <input type="checkbox" name="deleteGamesMedia">
                    <span>Delete the games roms and media (roms, marquees, flyers, logos)</span>
                </label>
                <label class="checkbox-row">
                    <input type="checkbox" name="deleteFavorites"${mameInfo.favoritesPath ? '' : ' disabled'}>
                    <span>Delete the favorites file${mameInfo.favoritesPath
                        ? ` (<code>${escapeHtml(mameInfo.favoritesPath)}</code>)`
                        : ' (no favorites.ini yet)'}</span>
                </label>
                <label class="checkbox-row">
                    <input type="checkbox" name="deleteMameHome" onchange="
                        this.form.deleteHiscores.checked = this.checked || this.form.deleteHiscores.checked;
                        this.form.deleteHiscores.disabled = this.checked;
                        this.form.deleteGamesMedia.checked = this.checked || this.form.deleteGamesMedia.checked;
                        this.form.deleteGamesMedia.disabled = this.checked;
                        this.form.deleteFavorites.checked = this.checked || this.form.deleteFavorites.checked;
                        this.form.deleteFavorites.disabled = this.checked || ${mameInfo.favoritesPath ? 'false' : 'true'};
                    ">
                        <span>
                            Delete the whole <code>${escapeHtml(mameInfo.iniPath)}</code> directory
                            <span class="checkbox-row-detail">Includes the options above, plus the
                            mame.ini/ui.ini configuration itself, cfg, nvram, snapshots... - MAME
                            will recreate it on its next launch.</span>
                        </span>
                </label>
                <button type="submit">Delete the selection</button>
            </form>
        </section>
    `;
}

interface InputProbeRow {
    player: 1 | 2;
    // MAME's own display name for the field, e.g. "P1 Up" / "P2 Button 3" - see
    // public/lua/input-probe.lua's is_wanted_field().
    fieldName: string;
    defaultText: string;
    currentText: string;
}

interface DeviceProbeRow {
    name: string;
    id: string;
    // "<item display name>=<MAME token>" pairs, e.g. "LB=BUTTON5" - kept as raw strings rather
    // than split further, this is a basic detection test, not a mapping UI yet.
    items: string[];
}

interface DeviceProbeState {
    result?: DeviceProbeRow[];
    error?: string;
}

/**
 * Line-based parse of device-probe.lua's stdout, same MAUI_..._ROW| convention as
 * parseInputProbeOutput() above - see that function's comment.
 */
function parseDeviceProbeOutput(stdout: string): DeviceProbeRow[] {
    const rows: DeviceProbeRow[] = [];
    for (const line of stdout.split('\n')) {
        if (!line.startsWith('MAUI_DEVICE_ROW|')) {
            continue;
        }
        const [, name, id, itemsRaw] = line.split('|');
        rows.push({
            name: name ?? '',
            id: id ?? '',
            items: itemsRaw ? itemsRaw.split(',').filter(Boolean) : [],
        });
    }
    return rows;
}

/**
 * Boots `romName` headlessly just long enough for device-probe.lua to dump every joystick/gamepad
 * device MAME currently detects and exit the machine - same approach as runInputProbe() above,
 * just a different Lua script and result shape. Which rom is booted doesn't matter (device
 * detection isn't per-game), it's only needed because -autoboot_script requires a running machine.
 */
function runDeviceProbe(mameBinary: string, iniPath: string, romName: string): DeviceProbeRow[] {
    const stdout = execFileSync(
        mameBinary,
        [
            romName,
            '-video', 'none',
            '-sound', 'none',
            '-skip_gameinfo',
            '-autoboot_delay', '0',
            '-autoboot_script', join(getStaticPath(), 'lua', 'device-probe.lua'),
            '-inipath', iniPath,
            '-homepath', iniPath,
        ],
        {
            cwd: iniPath,
            encoding: 'utf8',
            timeout: 15000,
            killSignal: 'SIGKILL',
            maxBuffer: 4 * 1024 * 1024,
            stdio: ['ignore', 'pipe', 'pipe'],
        },
    );
    return parseDeviceProbeOutput(stdout);
}

/**
 * Basic detection test, not a mapping UI: lists whatever joystick/gamepad devices MAME itself
 * currently sees, with the raw item name=token pairs (e.g. "LT=SLIDER1") it would accept in a
 * default.cfg <newseq> - useful to check a device is recognized, and under what token, before
 * hand-writing any cfg entry for it.
 */
function renderDeviceProbeCard(romNames: string[], state?: DeviceProbeState): string {
    if (!romNames.length) {
        return '';
    }
    const rows = (state?.result ?? []).map(device => `
        <tr>
            <td>${escapeHtml(device.name)}</td>
            <td><code>${escapeHtml(device.id)}</code></td>
            <td>${device.items.map(item => `<code>${escapeHtml(item)}</code>`).join(' ')}</td>
        </tr>
    `).join('');

    return `
        <section class="card">
            <h2>Detected devices (MAME probe)</h2>
            <p class="info">Runs a rom in the background (no video or sound) just to ask MAME
            which joysticks/gamepads it currently detects, and under which name/token
            (<code>JOYCODE_&lt;n&gt;_&lt;token&gt;</code>) each of their buttons/axes is
            recognized.</p>
            ${state?.error ? `<p class="error flash">${escapeHtml(state.error)}</p>` : ''}
            <form method="post" action="/input-probe/devices">
                <button type="submit">Detect gamepads</button>
            </form>
            ${state?.result ? (rows ? `
                <div class="table-wrap">
                    <table class="favorites-table">
                        <thead><tr><th>Device</th><th>ID</th><th>Buttons/axes</th></tr></thead>
                        <tbody>${rows}</tbody>
                    </table>
                </div>
            ` : '<p class="info flash">No joystick device detected.</p>') : ''}
        </section>
    `;
}

interface RemapAction {
    // MAME's own <port type="..."> value - see setDefaultCfgUiInput(). Also doubles as this
    // action's form/state identifier (see the "portType" hidden field and REMAP_ACTIONS_BY_TYPE
    // below), since it's already unique by construction (one cfg port per action).
    portType: string;
    label: string;
}

/**
 * Global (default.cfg, not per-game) remap actions offered on the Gamepads tab, grouped for
 * display. Grows over time (see renderRemapCard()'s own comment) - starts with just enough to
 * make the cabinet joystick-only usable: quitting a game, and P1's coin/start (the two inputs
 * every driver needs before its own P1 directions/buttons even come into play).
 */
const REMAP_GROUPS: { title: string; actions: RemapAction[] }[] = [
    {title: 'System', actions: [
        {portType: 'UI_CANCEL', label: 'Quit MAME'},
    ]},
    {title: 'Player 1', actions: [
        {portType: 'COIN1', label: 'Insert coin'},
        {portType: 'START1', label: 'Start'},
        {portType: 'P1_JOYSTICK_UP', label: 'Up'},
        {portType: 'P1_JOYSTICK_RIGHT', label: 'Right'},
        {portType: 'P1_JOYSTICK_DOWN', label: 'Down'},
        {portType: 'P1_JOYSTICK_LEFT', label: 'Left'},
        {portType: 'P1_BUTTON1', label: 'Button 1'},
        {portType: 'P1_BUTTON2', label: 'Button 2'},
        {portType: 'P1_BUTTON3', label: 'Button 3'},
        {portType: 'P1_BUTTON4', label: 'Button 4'},
        {portType: 'P1_BUTTON5', label: 'Button 5'},
        {portType: 'P1_BUTTON6', label: 'Button 6'},
        {portType: 'P1_BUTTON7', label: 'Button 7'},
        {portType: 'P1_BUTTON8', label: 'Button 8'},
    ]},
    {title: 'Player 2', actions: [
        {portType: 'COIN2', label: 'Insert coin'},
        {portType: 'START2', label: 'Start'},
        {portType: 'P2_JOYSTICK_UP', label: 'Up'},
        {portType: 'P2_JOYSTICK_RIGHT', label: 'Right'},
        {portType: 'P2_JOYSTICK_DOWN', label: 'Down'},
        {portType: 'P2_JOYSTICK_LEFT', label: 'Left'},
        {portType: 'P2_BUTTON1', label: 'Button 1'},
        {portType: 'P2_BUTTON2', label: 'Button 2'},
        {portType: 'P2_BUTTON3', label: 'Button 3'},
        {portType: 'P2_BUTTON4', label: 'Button 4'},
        {portType: 'P2_BUTTON5', label: 'Button 5'},
        {portType: 'P2_BUTTON6', label: 'Button 6'},
        {portType: 'P2_BUTTON7', label: 'Button 7'},
        {portType: 'P2_BUTTON8', label: 'Button 8'},
    ]},
];

const REMAP_ACTIONS_BY_TYPE = new Map<string, RemapAction>(
    REMAP_GROUPS.flatMap(group => group.actions).map(action => [action.portType, action]),
);

interface RemapState {
    // Which action this state is about - renderRemapCard() only shows a flash message on the one
    // form just submitted, not every action's form at once.
    portType: string;
    error?: string;
    capturedToken?: string;
    // In-game UI ports (see IN_GAME_UI_PORTS) the captured token was removed from because MAME
    // binds it to them by default - shown so the admin knows why e.g. the menu key changed.
    releasedFrom?: string[];
}

interface MameConfigSession {
    child: ChildProcess;
    dir: string;
    nonceCounter: number;
}

// Module-scope: at most one config session at a time, explicitly started/stopped by an admin from
// the Gamepads tab (see startMameConfigSession()/stopMameConfigSession()/captureOnePress() below) -
// there's only ever one admin configuring one cabinet's inputs, no need for more than one.
let mameConfigSession: MameConfigSession | undefined;

function isMameConfigSessionAlive(): boolean {
    return !!mameConfigSession && mameConfigSession.child.exitCode === null && !mameConfigSession.child.killed;
}

/**
 * Launches `romName` as a real, visible MAME window (not headless - see capture-daemon.lua's own
 * comment on why) and leaves it running until stopMameConfigSession() kills it. A no-op if a
 * session is already alive: only ever one at a time.
 *
 * This replaced a design that relaunched MAME headlessly for every single button capture: besides
 * the repeated ~1-2s boot cost, each relaunch re-enumerates joystick devices from scratch, and
 * with more than one controller connected MAME doesn't guarantee the same controller keeps the
 * same JOYCODE_<n> index between separate launches - two captures for the very same physical pad,
 * seconds apart, could resolve to different indices. One long-lived session fixes that: every
 * capture during it shares the same, single device enumeration.
 */
function startMameConfigSession(mameBinary: string, iniPath: string, romName: string): void {
    if (isMameConfigSessionAlive()) {
        return;
    }

    const dir = mkdtempSync(join(os.tmpdir(), 'maui-capture-'));
    const scriptTemplate = readFileSync(join(getStaticPath(), 'lua', 'capture-daemon.lua'), 'utf8');
    const scriptPath = join(dir, 'capture-daemon.lua');
    writeFileSync(scriptPath, scriptTemplate.replace('__CAPTURE_DIR__', dir), 'utf8');

    const child = spawn(
        mameBinary,
        [
            romName,
            '-skip_gameinfo',
            '-autoboot_delay', '0',
            '-autoboot_script', scriptPath,
            '-inipath', iniPath,
            '-homepath', iniPath,
        ],
        {cwd: iniPath, stdio: ['ignore', 'ignore', 'pipe']},
    );
    child.stderr?.on('data', (chunk: Buffer) => {
        console.error('[boServer] mame config session stderr:', chunk.toString('utf8').trim());
    });
    child.on('exit', () => {
        if (mameConfigSession?.child === child) {
            mameConfigSession = undefined;
        }
        rmSync(dir, {recursive: true, force: true});
    });

    mameConfigSession = {child, dir, nonceCounter: 0};
}

function stopMameConfigSession(): void {
    if (isMameConfigSessionAlive()) {
        // SIGKILL, not the default SIGTERM - confirmed by hand that a real windowed MAME process
        // just ignores SIGTERM outright (same "hung mame process can ignore SIGTERM under some
        // video backends" reason runInputProbe()/runCaptureInput() already used it for).
        mameConfigSession?.child.kill('SIGKILL');
    }
}

/**
 * Arms the running config session for one press and blocks - poll/sleep, same spirit as the
 * execFileSync-based probes elsewhere in this file, just spread across a loop instead of one
 * syscall - until it reports a result or CAPTURE_WAIT_MS runs out (generous: the admin needs time
 * to click back into MAME's window and press the right button - see capture-daemon.lua's comment
 * on focus). Returns the exact token MAME resolved the press to (e.g. "JOYCODE_1_BUTTON5"), null
 * if no session is running or nothing was captured in time.
 */
function captureOnePress(): string | null {
    if (!isMameConfigSessionAlive() || !mameConfigSession) {
        return null;
    }
    const session = mameConfigSession;
    const nonce = String(++session.nonceCounter);
    writeFileSync(join(session.dir, 'request.txt'), nonce, 'utf8');

    const CAPTURE_WAIT_MS = 30000;
    const resultPath = join(session.dir, 'result.txt');
    const deadline = Date.now() + CAPTURE_WAIT_MS;
    while (Date.now() < deadline) {
        if (!isMameConfigSessionAlive()) {
            return null;
        }
        if (existsSync(resultPath)) {
            const [resultNonce, token] = readFileSync(resultPath, 'utf8').split('|');
            if (resultNonce === nonce && token) {
                rmSync(resultPath, {force: true});
                return token.trim();
            }
        }
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 150);
    }
    return null;
}

/**
 * UI ports that fire *during* a game (not just inside a MAME menu) and ship with a joystick
 * button in their defaults - so a button remapped for anything else would trigger them as well.
 * Menu navigation ports (UI_SELECT, UI_UP, ...) also default to joystick buttons but are only
 * live while a menu is open, and stripping those would cripple the pad inside MAME's own menus.
 */
const IN_GAME_UI_PORTS = ['UI_MENU'];

const UI_PORT_LABELS: Record<string, string> = {
    UI_MENU: 'the MAME configuration menu (Tab key)',
};

/**
 * MAME doesn't take a button away from another port when default.cfg gives it to a new one: the
 * press then feeds both. (Observed on 0.289: UI_CANCEL on JOYCODE_1_BUTTON9 also opened UI_MENU's
 * config menu, its default binding.) So for every IN_GAME_UI_PORTS entry other than `portType`
 * whose effective sequence holds `token` - default.cfg's override if any, else what MAME reported
 * at session start (capture-daemon.lua's ui-seqs.txt) - writes that sequence back without it.
 * Returns the ports it changed.
 */
function releaseTokenFromInGameUiPorts(cfgPath: string, portType: string, token: string): string[] {
    if (!mameConfigSession) {
        return [];
    }
    const seqsPath = join(mameConfigSession.dir, 'ui-seqs.txt');
    const sessionSeqs = existsSync(seqsPath) ? parseUiSeqs(readFileSync(seqsPath, 'utf8')) : new Map<string, string>();
    const overrides = readDefaultCfgUiInputs(cfgPath);

    const released: string[] = [];
    for (const otherPort of IN_GAME_UI_PORTS) {
        const effective = overrides.get(otherPort) ?? sessionSeqs.get(otherPort);
        if (otherPort === portType || !effective) {
            continue;
        }
        const stripped = removeTokenFromSeq(effective, token);
        // null: the token was the port's only binding - leave it rather than hand-write an empty
        // sequence (see setDefaultCfgUiInput()'s note on hand-written <newseq> values).
        if (stripped && stripped !== effective) {
            setDefaultCfgUiInput(cfgPath, otherPort, stripped);
            released.push(otherPort);
        }
    }
    return released;
}

function getDefaultCfgPath(iniPath: string): string {
    return join(iniPath, 'cfg', 'default.cfg');
}

/**
 * Small hand-rolled edit of default.cfg's <input> block - not a general XML parser, and
 * deliberately not: MAME rewrites this file in its own canonical form on its next normal exit
 * regardless of the exact whitespace/attribute order used here. Only ever touches
 * <port type="..."><newseq type="standard">TOKEN</newseq></port> entries directly under
 * <system name="default"><input>, and only with `token` sourced from MAME's own
 * input:code_to_token() (see capture-daemon.lua) - never hand-guessed. That matters: MAME's cfg
 * loader was empirically observed to drop its *entire* <input> block (including an otherwise-valid
 * sibling entry) on the next boot after a single bad <newseq> token was written by hand.
 */
/**
 * Reads the <port type="..."><newseq type="standard">TOKEN</newseq></port> entries directly under
 * <system name="default"><input> - the same regex setDefaultCfgUiInput() below uses to avoid
 * clobbering them, exposed separately so renderRemapCard() can show what's actually persisted for
 * every action, not just whichever one a request just captured.
 */
function readDefaultCfgUiInputs(cfgPath: string): Map<string, string> {
    const ports = new Map<string, string>();
    if (!existsSync(cfgPath)) {
        return ports;
    }
    const inputBlockMatch = /<input>[\s\S]*?<\/input>/.exec(readFileSync(cfgPath, 'utf8'));
    if (!inputBlockMatch) {
        return ports;
    }
    const portRegex = /<port type="([^"]+)">\s*<newseq type="standard">([\s\S]*?)<\/newseq>\s*<\/port>/g;
    let match: RegExpExecArray | null;
    while ((match = portRegex.exec(inputBlockMatch[0])) !== null) {
        ports.set(match[1], match[2].trim());
    }
    return ports;
}

function setDefaultCfgUiInput(cfgPath: string, portType: string, token: string): void {
    const existing = existsSync(cfgPath) ? readFileSync(cfgPath, 'utf8') : `<?xml version="1.0"?>
<mameconfig version="10">
    <system name="default">
    </system>
</mameconfig>
`;

    const inputBlockMatch = /<input>[\s\S]*?<\/input>\s*/.exec(existing);
    const ports = readDefaultCfgUiInputs(cfgPath);
    ports.set(portType, token);

    const newInputBlock = '        <input>\n'
        + Array.from(ports.entries()).map(([type, seq]) => ''
            + `            <port type="${type}">\n`
            + '                <newseq type="standard">\n'
            + `                    ${seq}\n`
            + '                </newseq>\n'
            + '            </port>\n').join('')
        + '        </input>\n';

    const updated = inputBlockMatch
        ? existing.slice(0, inputBlockMatch.index) + newInputBlock + existing.slice(inputBlockMatch.index + inputBlockMatch[0].length)
        : existing.replace(/(<system name="default">\s*\n)/, `$1${newInputBlock}`);

    mkdirSync(dirname(cfgPath), {recursive: true});
    writeFileSync(cfgPath, updated, 'utf8');
}

/**
 * Global input remap: "Lancer MAME"/"Fermer MAME" control the shared config session
 * (startMameConfigSession()/stopMameConfigSession() above), and one "Capturer un appui" form per
 * REMAP_GROUPS action arms it for one press (captureOnePress() above) - the resulting token is
 * written straight into default.cfg's matching <port> entry (setDefaultCfgUiInput() above).
 * Groups/actions are meant to keep growing in REMAP_GROUPS - this only renders whatever's in it,
 * no other change needed to add more.
 */
function renderRemapCard(romNames: string[], persisted: Map<string, string>, state?: RemapState): string {
    if (!romNames.length) {
        return '';
    }
    const renderActionRows = (actions: RemapAction[]): string => actions.map(action => {
        const actionState = state?.portType === action.portType ? state : undefined;
        const currentToken = actionState?.capturedToken ?? persisted.get(action.portType);
        return `
            <tr>
                <td>${escapeHtml(action.label)}</td>
                <td>${currentToken ? `<code>${escapeHtml(currentToken)}</code>` : '<em>unassigned</em>'}</td>
                <td class="center">
                    <form method="post" action="/input-probe/remap">
                        <input type="hidden" name="portType" value="${escapeHtml(action.portType)}">
                        <button type="submit">Capture a press</button>
                    </form>
                </td>
            </tr>
            ${actionState?.error ? `
                <tr><td colspan="3"><p class="error flash">${escapeHtml(actionState.error)}</p></td></tr>
            ` : ''}
            ${actionState?.releasedFrom?.length ? `
                <tr><td colspan="3"><p class="info flash">This button was also bound by default to
                ${escapeHtml(actionState.releasedFrom.map(port => UI_PORT_LABELS[port] ?? port).join(', '))} in
                MAME - it was removed from there to avoid a double trigger.</p></td></tr>
            ` : ''}
        `;
    }).join('');

    const sessionRunning = isMameConfigSessionAlive();

    return `
        <section class="card">
            <h2>Global input configuration</h2>
            <p class="info">Binds a gamepad button to a command. <strong>1.</strong>
            Launch MAME below (a real window, not in the background) and leave it open
            for the whole configuration - all captures then share the same startup, so the
            same gamepad indexes from start to finish.
            <strong>2.</strong> Click "Capture a press" for the wanted command, then
            <strong>give the MAME window focus</strong> (click inside it) and press the
            button within 30 seconds - MAME only receives gamepad input while it is in the
            foreground. <strong>3.</strong> Close MAME when done. The result is written
            directly to <code>default.cfg</code> (valid for all games, unless a specific game
            has its own override). <strong>Currently</strong> reflects what is really saved
            in the file, not just the last capture.</p>
            <p><strong>MAME:</strong> ${sessionRunning ? 'running' : 'closed'}</p>
            <form method="post" action="/input-probe/mame/${sessionRunning ? 'stop' : 'start'}">
                <button type="submit">${sessionRunning ? 'Close MAME' : 'Launch MAME'}</button>
            </form>
            ${REMAP_GROUPS.map(group => `
                <h3>${escapeHtml(group.title)}</h3>
                <div class="table-wrap">
                    <table class="favorites-table">
                        <thead>
                            <tr><th>Command</th><th>Currently</th><th class="center"></th></tr>
                        </thead>
                        <tbody>${renderActionRows(group.actions)}</tbody>
                    </table>
                </div>
            `).join('')}
        </section>
    `;
}

interface InputProbeState {
    selectedRom?: string;
    result?: InputProbeRow[];
    error?: string;
}

/**
 * Maps MAME's own field display name (e.g. "P1 Up", "P2 Button 3") to a French label, stripping
 * the "P<n> " prefix. Falls back to the raw suffix for anything unexpected instead of throwing -
 * defensive only, input-probe.lua's own filter should never let anything else through.
 */
function labelForProbeFieldName(fieldName: string): string {
    const suffix = fieldName.replace(/^P[12] /, '');
    const directions: { [key: string]: string } = {Up: 'Up', Down: 'Down', Left: 'Left', Right: 'Right'};
    if (directions[suffix]) {
        return directions[suffix];
    }
    const buttonMatch = /^Button (\d+)$/.exec(suffix);
    return buttonMatch ? `Button ${buttonMatch[1]}` : suffix;
}

/**
 * Line-based parse of input-probe.lua's stdout, captured amid MAME's normal boot chatter (menu
 * hints, warnings, etc. on other lines - anything not starting with the marker is ignored).
 * Format, one line per wanted field: MAUI_INPUT_ROW|<field name>|<default text>|<current text>
 * e.g. "MAUI_INPUT_ROW|P1 Up|KEYCODE_UP|KEYCODE_UP or Joy1 Up". seq_name() never emits "|", so a
 * plain split is safe. Row order isn't guaranteed here (mirrors the Lua script's own pairs()
 * iteration) - renderInputProbeCard() sorts by player then a fixed direction/button order.
 */
function parseInputProbeOutput(stdout: string): InputProbeRow[] {
    const rows: InputProbeRow[] = [];
    for (const line of stdout.split('\n')) {
        if (!line.startsWith('MAUI_INPUT_ROW|')) {
            continue;
        }
        const [, fieldName, defaultText, currentText] = line.split('|');
        const playerMatch = /^P([12]) /.exec(fieldName || '');
        if (!playerMatch) {
            continue;
        }
        rows.push({
            player: Number(playerMatch[1]) as 1 | 2,
            fieldName,
            defaultText: defaultText ?? '',
            currentText: currentText ?? '',
        });
    }
    return rows;
}

/**
 * Boots `romName` headlessly just long enough for input-probe.lua to dump P1/P2's default vs.
 * current input sequences and exit the machine, then parses the captured stdout. -skip_gameinfo
 * avoids an extra keypress-wait; -video none/-sound none skip creating a window or touching the
 * audio device entirely (no emulation beyond machine start is meant to be seen or heard). timeout
 * is a hard backstop in case a driver never reaches "running" (bad rom, missing BIOS) - the Lua
 * script's own machine:exit() should fire in well under a second normally. killSignal SIGKILL
 * (not the default SIGTERM) because a hung mame process can ignore SIGTERM under some video
 * backends. maxBuffer covers MAME's boot-time stdout chatter, which stays well under a few KB per
 * run in practice.
 */
function runInputProbe(mameBinary: string, iniPath: string, romName: string): InputProbeRow[] {
    const stdout = execFileSync(
        mameBinary,
        [
            romName,
            '-video', 'none',
            '-sound', 'none',
            '-skip_gameinfo',
            '-autoboot_delay', '0',
            '-autoboot_script', join(getStaticPath(), 'lua', 'input-probe.lua'),
            '-inipath', iniPath,
            '-homepath', iniPath,
        ],
        {
            cwd: iniPath,
            encoding: 'utf8',
            timeout: 15000,
            killSignal: 'SIGKILL',
            maxBuffer: 4 * 1024 * 1024,
            stdio: ['ignore', 'pipe', 'pipe'],
        },
    );
    return parseInputProbeOutput(stdout);
}

/**
 * On-demand MAME Lua probe for P1/P2 controller bindings: an admin picks a rom, mame boots it
 * headlessly with input-probe.lua (-autoboot_script), and this renders what that script printed -
 * MAME's own hardcoded default *and* its current effective (merged, post-cfg-override) value for
 * each field, side by side. Unlike a static default.cfg viewer, this reflects per-game
 * <romname>.cfg overrides too, because that's exactly what MAME itself just resolved while
 * booting that rom - see input-probe.lua and runInputProbe() above.
 */
function renderInputProbeCard(romNames: string[], state?: InputProbeState): string {
    if (!romNames.length) {
        return `
            <section class="card">
                <h2>Keys and gamepads (MAME probe)</h2>
                <p class="info flash">No rom found in the roms folder - import a starting
                pack or drop at least one .zip file in that folder to be able to probe an
                input configuration.</p>
            </section>
        `;
    }

    const options = romNames.map(romName => `
        <option value="${escapeHtml(romName)}" ${state?.selectedRom === romName ? 'selected' : ''}>
            ${escapeHtml(romName)}
        </option>
    `).join('');

    const renderPlayerTable = (player: 1 | 2): string => {
        const directionOrder = ['Up', 'Down', 'Left', 'Right'];
        const rank = (fieldName: string): [number, number] => {
            const suffix = fieldName.replace(/^P[12] /, '');
            const directionIndex = directionOrder.indexOf(suffix);
            if (directionIndex !== -1) {
                return [0, directionIndex];
            }
            const buttonMatch = /^Button (\d+)$/.exec(suffix);
            if (buttonMatch) {
                return [1, Number(buttonMatch[1])];
            }
            if (suffix === 'Start') {
                return [2, 0];
            }
            if (suffix === 'Coin') {
                return [3, 0];
            }
            return [4, 0];
        };
        const rows = (state?.result ?? [])
            .filter(row => row.player === player)
            .sort((a, b) => {
                const [groupA, orderA] = rank(a.fieldName);
                const [groupB, orderB] = rank(b.fieldName);
                return groupA - groupB || orderA - orderB;
            })
            .map((row) => {
                const overridden = row.currentText !== row.defaultText;
                const currentCell = overridden
                    ? `<strong>${escapeHtml(row.currentText)}</strong>`
                    : escapeHtml(row.currentText);
                return `
                    <tr>
                        <td>${escapeHtml(labelForProbeFieldName(row.fieldName))}</td>
                        <td>${escapeHtml(row.defaultText)}</td>
                        <td>${currentCell}</td>
                    </tr>
                `;
            }).join('');
        return `
            <h3>Player ${player}</h3>
            ${rows ? `
                <div class="table-wrap">
                    <table class="favorites-table">
                        <thead><tr><th>Command</th><th>Default</th><th>Current</th></tr></thead>
                        <tbody>${rows}</tbody>
                    </table>
                </div>
            ` : '<p class="info flash">No binding found for this player.</p>'}
        `;
    };

    return `
        <section class="card">
            <h2>Keys and gamepads (MAME probe)</h2>
            <p class="info">Runs the selected rom in the background (no video or sound) to
            ask MAME itself for its P1/P2 input configuration (joystick directions,
            buttons, start and coin) - <strong>Default</strong> is MAME's original value,
            <strong>Current</strong> is the effective value once the global and per-game
            settings are applied (in <strong>bold</strong> when it differs from the default).
            <code>KEYCODE_*</code> = keyboard key, <code>JOYCODE_&lt;n&gt;_*</code> = gamepad
            no. n; several bindings can be combined with OR/AND/NOT.</p>
            ${state?.error ? `<p class="error flash">${escapeHtml(state.error)}</p>` : ''}
            <form method="post" action="/input-probe">
                <label for="probeRomName">Rom</label>
                <select id="probeRomName" name="romName">${options}</select>
                <button type="submit">Probe</button>
            </form>
            ${state?.result ? `${renderPlayerTable(1)}${renderPlayerTable(2)}` : ''}
        </section>
    `;
}

/**
 * Danger zone for mame-awesome-ui's own data (config file, database - see Config.class.ts /
 * Database.class.ts). Rendered on the "maui" tab. See renderMameDangerZoneCard() above for the
 * MAME-side counterpart on the "mame" tab.
 */
function renderMauiDangerZoneCard(info?: string): string {
    return `
        <section class="card">
            <h2>Danger zone</h2>
            <p class="error">Targeted, irreversible deletions of mame-awesome-ui's own data. Each
            checkbox acts independently of the others - tick what you want to delete, then
            submit. Deleting the configuration or the database then closes the application; it
            has to be relaunched manually (<code>just serve</code> in development) to complete
            the operation.</p>
            ${info ? `<p class="info flash">${escapeHtml(info)}</p>` : ''}
            <form method="post" action="/reset" onsubmit="
                var items = [];
                if (this.deleteConfig.checked) items.push('the mame-awesome-ui configuration');
                if (this.deleteDatabase.checked) items.push('the database (games, players, scores)');
                if (!items.length) { return true; }
                return confirm('Permanently delete ' + items.join(', ') + '? This cannot be undone.');
            ">
                <input type="hidden" name="zone" value="maui">
                <label class="checkbox-row">
                    <input type="checkbox" name="deleteConfig">
                    Delete the mame-awesome-ui configuration (mame-awesome-ui-config.json)
                </label>
                <label class="checkbox-row">
                    <input type="checkbox" name="deleteDatabase">
                    Delete the database (games, players, scores)
                </label>
                <button type="submit">Delete the selection</button>
            </form>
        </section>
    `;
}

function renderForm(
    values: ConfigFormValues,
    mameInfo: MameInfo,
    isAdmin: boolean,
    error?: string,
    info?: string,
    mameInfoMessage?: string,
    importError?: string,
    dangerZoneInfo?: string,
    inputProbeState?: InputProbeState,
    repoPacks?: RepoPack[],
    repoError?: string,
    repoInfo?: string,
    deviceProbeState?: DeviceProbeState,
    remapState?: RemapState,
): string {
    // Loaded fresh rather than threaded through every renderForm() call site (there are many -
    // see /save, /launch, /mame-options/save, /reset, etc.) purely for the repo card's
    // credential fields; a sync JSON read is cheap and every route already re-loads Config at
    // least once per request anyway.
    const config = new Config();
    config.load();

    const sections: Subsection[] = [
        {id: 'config', label: 'Config', html: renderConfigCard(values, isAdmin, error, info)},
        {id: 'infos', label: 'Infos', html: renderMameInfoCard(mameInfo, mameInfoMessage)},
    ];
    // Import and the danger zone both act on paths resolved from the binary's own -showconfig/
    // ui.ini output (rompath, marquees/flyers/logos directories, categorypath...) - until it's
    // configured and validated (mameInfo.error unset), those paths don't exist, so none of these
    // sections have anything meaningful to show or act on.
    if (!mameInfo.error) {
        // Starting packs are MAME-only content (roms/artwork/favorites/categories/player
        // counts, all resolved from this same MAME install) - kept on this tab instead of
        // its own, next to the MAME info it depends on and updates.
        // Admin-only: every action on this tab spawns MAME on the machine hosting the BO (and the
        // remap card rewrites default.cfg) - their routes reject non-admins server-side too.
        if (isAdmin) {
            sections.push({
                id: 'gamepads',
                label: 'Gamepads',
                html: renderInputProbeCard(mameInfo.romPath ? listRomNames(mameInfo.romPath) : [], inputProbeState)
                    + renderRemapCard(
                        mameInfo.romPath ? listRomNames(mameInfo.romPath) : [],
                        readDefaultCfgUiInputs(getDefaultCfgPath(mameInfo.iniPath)),
                        remapState,
                    )
                    + renderDeviceProbeCard(mameInfo.romPath ? listRomNames(mameInfo.romPath) : [], deviceProbeState),
            });
        }
        sections.push({
            id: 'import',
            label: 'Import',
            // renderPythonWarning() is meant to sit right above renderImportCard() (see its own
            // comment) - not a section of its own.
            html: renderPythonWarning() + renderImportCard(importError),
        });
        // Destructive/irreversible - only shown (and only actionable, see /reset) for admins.
        if (isAdmin) {
            sections.push({
                id: 'repository',
                label: 'Repository',
                html: renderRepoImportCard(config, mameInfo, repoPacks, repoError, repoInfo),
            });
            sections.push({
                id: 'danger',
                label: 'Danger',
                html: renderMameDangerZoneCard(mameInfo, dangerZoneInfo),
            });
        }
    }
    // Which of the params above is actually filled in tells us which section this specific
    // response is about - e.g. a POST to /repo/save only ever sets repoInfo/repoError, nothing
    // else, regardless of what other sections might separately have a standing .flash warning
    // of their own (missing plugins, no python3...) that would otherwise wrongly win just for
    // being earlier in `sections` (see renderPageTail()'s script). Most specific first.
    const defaultSubtab = dangerZoneInfo !== undefined ? 'danger'
        : (repoError !== undefined || repoInfo !== undefined || repoPacks !== undefined) ? 'repository'
            : importError !== undefined ? 'import'
                : (inputProbeState !== undefined || deviceProbeState !== undefined || remapState !== undefined) ? 'gamepads'
                    : mameInfoMessage !== undefined ? 'infos'
                        : (error !== undefined || info !== undefined) ? 'config'
                            : undefined;
    return renderSubtabbedPage('mame', sections, true, defaultSubtab);
}

const GITHUB_REPO = 'Arcadoolic/maui';

interface GithubReleaseAsset {
    name: string;
    browser_download_url: string;
}

interface GithubRelease {
    tag_name: string;
    name: string | null;
    body: string | null;
    published_at: string;
    prerelease: boolean;
    assets: GithubReleaseAsset[];
}

interface UpdateReleaseEntry {
    tagName: string;
    name: string;
    publishedAt: string;
    assetUrl: string | null;
    isCurrent: boolean;
    isPrerelease: boolean;
}

interface UpdateInfo {
    capable: boolean;
    currentVersion: string;
    releases: UpdateReleaseEntry[];
    devBuilds: UpdateReleaseEntry[];
    releasesError?: string;
}

// x64/arm64 are the only archs mame-awesome-ui packages for Linux (electron-builder.yml has no
// arm64 Windows/other Linux arch target) - anything else (e.g. a 32-bit Pi image) has nothing to
// match against and self-update stays unavailable, same as a non-Linux platform.
function currentLinuxArch(): 'x64' | 'arm64' | null {
    return process.arch === 'x64' || process.arch === 'arm64' ? process.arch : null;
}

/**
 * package.json's version plus, for develop builds, "+dev.<short sha>" (see
 * electron.vite.config.ts) - the same string as that build's GitHub prerelease tag, so it is both
 * what the BO header shows and what the releases list matches "version actuelle" against.
 */
function getRunningVersion(): string {
    const suffix = typeof MAUI_BUILD_VERSION_SUFFIX === 'string' ? MAUI_BUILD_VERSION_SUFFIX : '';
    return electronApp.getVersion() + suffix;
}

function getSquashfsRootPath(): string {
    return join(os.homedir(), 'squashfs-root');
}

// Mirrors the dedicated-system layout documented in docs/RASPBERRY-PI-DEPLOY.md §5.3/§7: the
// AppImage extracted once into a fixed ~/squashfs-root, referenced by path from ~/.xinitrc. Ruled
// out in development (app.isPackaged) so this never fires from a repo checkout that happens to also
// have a stray ~/squashfs-root from a real install on the same machine.
function isSelfUpdateCapable(): boolean {
    return process.platform === 'linux' && electronApp.isPackaged
        && existsSync(join(getSquashfsRootPath(), 'AppRun'));
}

let releasesCache: {fetchedAt: number; releases: GithubRelease[]} | null = null;
const GITHUB_CACHE_TTL_MS = 5 * 60 * 1000;

// Public GitHub Releases - no auth needed (repo is public), so this is safe to call for every
// BO role, not just admins. Cached briefly so repeatedly loading the MAUI tab doesn't burn
// through the anonymous API's 60 req/h/IP rate limit. Includes both real releases (tagged on
// main by semantic-release) and dev prereleases (tagged on every push to develop by build.yml,
// see its "Publish develop prerelease" job) - GitHub's /releases endpoint returns both, told
// apart by the `prerelease` flag.
async function fetchGithubReleases(): Promise<GithubRelease[]> {
    if (releasesCache && Date.now() - releasesCache.fetchedAt < GITHUB_CACHE_TTL_MS) {
        return releasesCache.releases;
    }
    const response = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/releases`, {
        headers: {Accept: 'application/vnd.github+json'},
    });
    if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
    }
    const releases = await response.json() as GithubRelease[];
    releasesCache = {fetchedAt: Date.now(), releases};
    return releases;
}

/**
 * Computes everything the "Update" subtab needs to render: the public releases list (any
 * BO role can see/install those), split into real releases and develop prereleases (the latter
 * only rendered for admins, see renderUpdateCard()). Called by every route that (re-)renders
 * the MAUI page, same as getMameInfo() is recomputed fresh by every route touching the MAME tab.
 */
async function getUpdateInfo(): Promise<UpdateInfo> {
    const info: UpdateInfo = {
        capable: isSelfUpdateCapable(),
        currentVersion: getRunningVersion(),
        releases: [],
        devBuilds: [],
    };

    try {
        const releases = await fetchGithubReleases();
        const arch = currentLinuxArch();
        const entries = releases.map((release): UpdateReleaseEntry => {
            const asset = arch
                ? release.assets.find(a => new RegExp(`-linux-${arch}\\.AppImage$`).test(a.name))
                : undefined;
            return {
                tagName: release.tag_name,
                name: release.name || release.tag_name,
                publishedAt: release.published_at,
                assetUrl: asset ? asset.browser_download_url : null,
                isCurrent: release.tag_name === info.currentVersion,
                isPrerelease: release.prerelease,
            };
        });
        // Sorted here, not left in the API's order - see sortByPublishedDesc().
        info.releases = sortByPublishedDesc(entries.filter(entry => !entry.isPrerelease));
        info.devBuilds = sortByPublishedDesc(entries.filter(entry => entry.isPrerelease));
    } catch (error) {
        info.releasesError = error instanceof Error ? error.message : 'unexpected error';
    }

    return info;
}

/**
 * Downloads `downloadUrl` (a raw release asset - real releases and develop-prerelease builds
 * are published the same way, see getUpdateInfo()) and swaps it into ~/squashfs-root (see
 * getSquashfsRootPath()) - same end state as docs/RASPBERRY-PI-DEPLOY.md §7's manual `rm -rf` +
 * re-extract, but via an atomic rename into a fresh temp dir first, so ~/squashfs-root.old stays
 * available as a manual rollback if the new version turns out broken, and the currently-running
 * process's own files are never touched mid-extraction. Streams progress the same way as
 * runImportScript() above - res must already have its page head written.
 */
async function runUpdateInstall(res: Response, title: string, downloadUrl: string): Promise<void> {
    res.write(`<section class="card"><h2>${escapeHtml(title)}</h2>${PROGRESS_LOG_OPEN}`);
    const writeLine = (line: string): void => {
        res.write(`<li>${escapeHtml(line)}</li>`);
    };

    const squashfsRoot = getSquashfsRootPath();
    // Next to ~/squashfs-root, not in os.tmpdir(): /tmp is a separate tmpfs on Debian/Raspberry Pi
    // OS, and renameSync() across devices fails with EXDEV - which used to happen *after* the
    // current install had already been moved to .old, leaving no ~/squashfs-root at all.
    const workDir = mkdtempSync(join(dirname(squashfsRoot), '.mame-awesome-ui-update-'));
    try {
        writeLine('Downloading…');
        const response = await fetch(downloadUrl);
        if (!response.ok || !response.body) {
            throw new Error(`Download failed (HTTP ${response.status}).`);
        }
        const totalBytes = Number(response.headers.get('content-length')) || 0;
        const appImagePath = join(workDir, 'download.AppImage');
        let downloadedBytes = 0;
        let lastLoggedMb = 0;
        await pipeline(
            // Node's fetch typings (undici) and DOM's lib.dom ReadableStream diverge slightly -
            // both are the real web ReadableStream at runtime, fromWeb() just wants any of them.
            Readable.fromWeb(response.body as import('stream/web').ReadableStream<Uint8Array>),
            new Transform({
                transform(chunk, _enc, callback) {
                    downloadedBytes += chunk.length;
                    const mb = Math.floor(downloadedBytes / (1024 * 1024));
                    if (mb > lastLoggedMb) {
                        lastLoggedMb = mb;
                        const totalMb = totalBytes ? Math.round(totalBytes / (1024 * 1024)) : undefined;
                        writeLine(totalMb ? `Downloaded: ${mb} MB / ${totalMb} MB` : `Downloaded: ${mb} MB`);
                    }
                    callback(null, chunk);
                },
            }),
            createWriteStream(appImagePath),
        );

        chmodSync(appImagePath, 0o755);

        writeLine('Extracting the AppImage…');
        execFileSync(appImagePath, ['--appimage-extract'], {cwd: workDir, stdio: ['ignore', 'pipe', 'pipe']});

        const newSquashfsRoot = join(workDir, 'squashfs-root');
        if (!existsSync(newSquashfsRoot)) {
            throw new Error('Extraction finished but squashfs-root was not found in the AppImage.');
        }

        const oldSquashfsRoot = `${squashfsRoot}.old`;
        // The previous .old is parked in workDir (deleted with it in finally) rather than removed
        // up front, so it can be put back if the swap fails.
        const parkedOldSquashfsRoot = join(workDir, 'previous.old');
        writeLine('Switching to the new version…');
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

        writeLine(
            'Update installed. Restart the Pi (or "sudo systemctl restart getty@tty1") '
            + 'to apply the new version. The previous version stays available in '
            + '~/squashfs-root.old while the new one is being validated.',
        );
    } catch (error) {
        const message = error instanceof Error ? error.message : 'unexpected error';
        writeLine(`Failed: ${message}`);
    } finally {
        rmSync(workDir, {recursive: true, force: true});
    }

    res.write('</ul></section>');
}

function renderUpdateReleaseRow(release: UpdateReleaseEntry, capable: boolean, confirmLabel: string): string {
    return `
        <tr>
            <td>${escapeHtml(release.name)}${release.isCurrent ? ' <span class="badge-yes">current version</span>' : ''}</td>
            <td>${escapeHtml(formatPublishedAt(release.publishedAt))}</td>
            <td class="center">
                ${release.assetUrl && !release.isCurrent ? `
                    <form method="post" action="/maui/update/install"
                        onsubmit="return confirm('${confirmLabel.replace('{tag}', escapeHtml(release.tagName))}')">
                        <input type="hidden" name="tagName" value="${escapeHtml(release.tagName)}">
                        <input type="hidden" name="assetUrl" value="${escapeHtml(release.assetUrl)}">
                        <button type="submit" ${capable ? '' : 'disabled'}>Install</button>
                    </form>
                ` : release.isCurrent ? '' : '<em>No artifact for this platform</em>'}
            </td>
        </tr>
    `;
}

function renderUpdateCard(
    updateInfo: UpdateInfo, isAdmin: boolean, installMessage?: string, installError?: string,
): string {
    const confirmRelease = 'Install version {tag}? The Pi will then need to be restarted.';
    const releaseRows = updateInfo.releases
        .map(release => renderUpdateReleaseRow(release, updateInfo.capable, confirmRelease))
        .join('');

    const confirmDevBuild = 'Install the development build {tag} (not promoted to main)? '
        + 'The Pi will then need to be restarted.';
    const devBuildRows = updateInfo.devBuilds
        .map(release => renderUpdateReleaseRow(release, updateInfo.capable, confirmDevBuild))
        .join('');

    return `
        <section class="card">
            <h2>Update</h2>
            <p class="info">Currently installed version: <strong>${escapeHtml(updateInfo.currentVersion)}</strong></p>
            ${!updateInfo.capable ? `
                <p class="error">Automatic installation is unavailable on this machine (expected:
                Linux, not in development, AppImage extracted in ~/squashfs-root - see
                docs/RASPBERRY-PI-DEPLOY.md). Releases can still be browsed below.</p>
            ` : ''}
            ${installError ? `<p class="error flash">${escapeHtml(installError)}</p>` : ''}
            ${installMessage ? `<p class="info flash">${escapeHtml(installMessage)}</p>` : ''}
            ${updateInfo.releasesError
                ? `<p class="error">Unable to fetch the GitHub releases: ${escapeHtml(updateInfo.releasesError)}</p>`
                : `<table>
                    <thead><tr><th>Version</th><th>Published on</th><th></th></tr></thead>
                    <tbody>${releaseRows || '<tr><td colspan="3"><em>No release found.</em></td></tr>'}</tbody>
                </table>`}
        </section>
        ${isAdmin ? `
            <section class="card">
                <h2>Development builds (unpublished)</h2>
                <p class="error">GitHub prereleases generated automatically on every push to
                develop (workflow "Build") - not yet promoted to main, meant for testing only.</p>
                ${!updateInfo.releasesError
                    ? `<table>
                        <thead><tr><th>Version</th><th>Published on</th><th></th></tr></thead>
                        <tbody>${devBuildRows || '<tr><td colspan="3"><em>No build available.</em></td></tr>'}</tbody>
                    </table>`
                    : ''}
            </section>
        ` : ''}
    `;
}

function renderMauiCard(config: Config, info?: string): string {
    return `
        <section class="card">
            <h2>mame-awesome-ui</h2>
            ${info ? `<p class="info flash">${escapeHtml(info)}</p>` : ''}
            <form method="post" action="/maui/save">
                <label class="checkbox-row">
                    <input type="checkbox" name="fullscreen" ${config.fullscreen ? 'checked' : ''}>
                    Show fullscreen (unchecked = windowed)
                </label>
                <label class="checkbox-row">
                    <input type="checkbox" name="openDevTools" ${config.openDevTools ? 'checked' : ''}>
                    Open DevTools on startup (development mode)
                </label>
                <button type="submit">Save</button>
            </form>
        </section>
    `;
}

function renderMauiImportExportCard(error?: string, info?: string): string {
    return `
        <section class="card">
            <h2>mame-awesome-ui import / export</h2>
            <p class="info">Backs up or restores the configuration
            (mame-awesome-ui-config.json) and/or the database (games, players, scores)
            of mame-awesome-ui - not the roms nor mame's own data.</p>
            ${error ? `<p class="error flash">${escapeHtml(error)}</p>` : ''}
            ${info ? `<p class="info flash">${escapeHtml(info)}</p>` : ''}
            <form method="get" action="/maui/export">
                <label class="checkbox-row">
                    <input type="checkbox" name="json" checked>
                    Configuration (JSON)
                </label>
                <label class="checkbox-row">
                    <input type="checkbox" name="db">
                    Database (DB)
                </label>
                <button type="submit">Export</button>
            </form>
            <form method="post" action="/maui/import" enctype="multipart/form-data"
                onsubmit="return confirm('Overwrite the current configuration and/or database with this file? This cannot be undone.')">
                <label for="mauiImportFile">File to import (.json, .sqlite/.db, or a .zip containing both)</label>
                <input type="file" id="mauiImportFile" name="file" accept=".json,.sqlite,.db,.zip" required>
                <button type="submit">Import</button>
            </form>
        </section>
    `;
}

interface MauiPageMessages {
    mauiInfo?: string;
    importExportError?: string;
    importExportInfo?: string;
    dangerZoneInfo?: string;
    updateInfoMessage?: string;
    updateInfoError?: string;
}

/**
 * Read-only list of the controls MAUI itself understands (see MauiControls.ts, which the screens
 * switch on too), per screen, with what each does. The controller column follows the "standard"
 * layout of controllers.json - what Gamepads.class.ts falls back to for any pad it has no entry
 * for - and any pad with an entry of its own is listed under it.
 */
function renderMauiControlsCard(): string {
    const mappings = ControllerMappings as unknown as Record<string, ControllerMapping>;
    const standard = mappings.standard;
    const renderInputs = (inputs: string[]): string => inputs.length
        ? inputs.map(input => `<code>${escapeHtml(input)}</code>`).join(' ')
        : '<em>no input</em>';

    const renderLongPress = (ms?: number): string => ms === undefined ? '' : ` <em>long press (${ms / 1000} s)</em>`;

    const contextTables = MAUI_CONTROL_CONTEXTS.map(context => `
        <h3>${escapeHtml(context.title)}</h3>
        <div class="table-wrap">
            <table class="favorites-table">
                <thead>
                    <tr><th>Key</th><th>Role</th><th>Gamepad (standard layout)</th></tr>
                </thead>
                <tbody>${context.controls.map(control => `
                    <tr>
                        <td><code>${escapeHtml(keyLabel(control.key))}</code>${renderLongPress(control.longPressMs)}</td>
                        <td>${escapeHtml(control.role)}</td>
                        <td>${renderInputs(describeGamepadInputs(standard, control.key, STANDARD_BUTTON_NAMES))}</td>
                    </tr>`).join('')}
                </tbody>
            </table>
        </div>
    `).join('');

    const specificPads = Object.entries(mappings).filter(([name]) => name !== 'standard');
    const specificPadsHtml = specificPads.length ? `
        <details>
            <summary>Gamepads with their own layout (${specificPads.length})</summary>
            ${specificPads.map(([name, mapping]) => `
                <h3>${escapeHtml(name)}</h3>
                <div class="table-wrap">
                    <table class="favorites-table">
                        <thead><tr><th>Key</th><th>Gamepad inputs</th></tr></thead>
                        <tbody>${Object.values(MAUI_KEYS).map(key => `
                            <tr>
                                <td><code>${escapeHtml(keyLabel(key))}</code></td>
                                <td>${renderInputs(describeGamepadInputs(mapping, key))}</td>
                            </tr>`).join('')}
                        </tbody>
                    </table>
                </div>
            `).join('')}
        </details>
    ` : '';

    return `
        <section class="card">
            <h2>MAUI controls</h2>
            <p class="info">The keys the cabinet interface understands, with their role. The
            same keys do not have the same role depending on the screen. A gamepad produces these keys via
            <code>controllers.json</code>: an entry reading <em>no input</em> means the
            command is only reachable from the keyboard with this layout. Not to be confused with the MAME
            &gt; Gamepads tab, which sets MAME's inputs (in games) and not MAUI's.</p>
            ${contextTables}
            ${specificPadsHtml}
        </section>
    `;
}

function renderMauiPage(
    config: Config, messages: MauiPageMessages = {}, isAdmin: boolean = false,
    updateInfo?: UpdateInfo,
): string {
    const sections: Subsection[] = [
        {id: 'general', label: 'General', html: renderMauiCard(config, messages.mauiInfo)},
        {id: 'controls', label: 'Controls', html: renderMauiControlsCard()},
    ];
    if (updateInfo) {
        sections.push({
            id: 'update',
            label: 'Update',
            html: renderUpdateCard(updateInfo, isAdmin, messages.updateInfoMessage, messages.updateInfoError),
        });
    }
    // Import/export and the danger zone both act on the app's own config/database - only
    // shown (and only actionable, see /maui/export, /maui/import and /reset) for admins.
    if (isAdmin) {
        sections.push({
            id: 'import-export',
            label: 'Import/Export',
            html: renderMauiImportExportCard(messages.importExportError, messages.importExportInfo),
        });
        sections.push({id: 'danger', label: 'Danger', html: renderMauiDangerZoneCard(messages.dangerZoneInfo)});
    }
    // See renderForm()'s own defaultSubtab for why this is computed from which message was
    // actually passed for this response, not inferred client-side from scanning for .flash.
    const defaultSubtab = messages.dangerZoneInfo !== undefined ? 'danger'
        : (messages.importExportError !== undefined || messages.importExportInfo !== undefined) ? 'import-export'
            : (messages.updateInfoMessage !== undefined || messages.updateInfoError !== undefined) ? 'update'
                : messages.mauiInfo !== undefined ? 'general'
                    : undefined;
    return renderSubtabbedPage('maui', sections, true, defaultSubtab);
}

/**
 * Thin wrapper around renderMauiPage() that also computes UpdateInfo (see getUpdateInfo()) -
 * every route that re-renders the MAUI page needs it, same as every /mame-tab route re-resolves
 * MameInfo via getMameInfo(). Centralized here instead of repeated at each of the ~7 call sites.
 */
async function sendMauiPage(
    req: express.Request, res: Response, config: Config, messages: MauiPageMessages = {},
): Promise<void> {
    const isAdmin = req.session.boRole === 'admin';
    const updateInfo = await getUpdateInfo();
    res.send(renderMauiPage(config, messages, isAdmin, updateInfo));
}

function renderScreenScraperCard(values: ScreenScraperValues, error?: string, info?: string): string {
    return `
        <section class="card">
            <h2>ScreenScraper</h2>
            <p>Credentials used to fetch marquees, flyers and other artwork from
            <a href="https://www.screenscraper.fr" target="_blank" rel="noopener">screenscraper.fr</a>.</p>
            ${error ? `<p class="error flash">${escapeHtml(error)}</p>` : ''}
            ${info ? `<p class="info flash">${escapeHtml(info)}</p>` : ''}
            <form method="post" action="/screenscraper/save" novalidate>
                <label for="ssUserId">User ID (ssid)</label>
                <input type="text" id="ssUserId" name="ssUserId" value="${escapeHtml(values.ssUserId)}" autocomplete="off">
                <label for="ssUserPassword">User password (sspassword)</label>
                <input type="password" id="ssUserPassword" name="ssUserPassword" value="${escapeHtml(values.ssUserPassword)}" autocomplete="off">

                <label for="ssSoftName">Software name (softname)</label>
                <input type="text" id="ssSoftName" name="ssSoftName" value="${escapeHtml(values.ssSoftName)}" autocomplete="off">
                <label for="ssDevId">Developer ID (devid) — to be created on screenscraper.fr, the application provides no default value</label>
                <input type="text" id="ssDevId" name="ssDevId" value="${escapeHtml(values.ssDevId)}" autocomplete="off">
                <label for="ssDevPassword">Developer password (devpassword)</label>
                <input type="password" id="ssDevPassword" name="ssDevPassword" value="${escapeHtml(values.ssDevPassword)}" autocomplete="off">

                <label for="bezelAspect">Bezel format (aspect_ratio of the target screen)</label>
                <select id="bezelAspect" name="bezelAspect">
                    <option value="16:9" ${values.bezelAspect === '16:9' ? 'selected' : ''}>16:9 (widescreen)</option>
                    <option value="4:3" ${values.bezelAspect === '4:3' ? 'selected' : ''}>4:3 (standard screen)</option>
                </select>
                <button type="submit">Save</button>
            </form>
        </section>
    `;
}

/**
 * Media-download trigger, moved here from the favorites tab (see renderFavoritesCard()) since
 * it's a ScreenScraper action, not a favorites-list concern - the favorites table stays there,
 * showing per-rom marquee/flyer/logo status, with a pointer back to this tab for the button.
 */
function renderScreenScraperDownloadCard(hasCreds: boolean, error?: string, summary?: DownloadSummary): string {
    if (!hasCreds) {
        return `
            <section class="card">
                <h2>Media download</h2>
                <p class="error flash">ScreenScraper credentials missing: fill them in (Credentials
                tab) before starting a download.</p>
            </section>
        `;
    }
    return `
        <section class="card">
            <h2>Media download</h2>
            ${error ? `<p class="error flash">${escapeHtml(error)}</p>` : ''}
            ${summary ? renderDownloadSummary(summary) : ''}
            <form method="post" action="/favorites/download-media">
                <p class="info">Downloads the missing marquees/flyers/logos from ScreenScraper for all
                the favorites. Synchronous processing, may take several minutes depending on the number of favorites
                (a delay is enforced between calls) - do not close this page during the download.</p>
                <button type="submit">Download the missing artwork</button>
            </form>
        </section>
    `;
}

function renderScreenScraperPage(
    values: ScreenScraperValues,
    hasCreds: boolean,
    error?: string,
    info?: string,
    downloadError?: string,
    summary?: DownloadSummary,
): string {
    // See renderForm()'s own defaultSubtab for why this is computed from which message was
    // actually passed for this response, not inferred client-side from scanning for .flash.
    const defaultSubtab = (downloadError !== undefined || summary !== undefined) ? 'download'
        : (error !== undefined || info !== undefined) ? 'credentials'
            : undefined;
    return renderSubtabbedPage('screenscraper', [
        {id: 'credentials', label: 'Credentials', html: renderScreenScraperCard(values, error, info)},
        {
            id: 'download',
            label: 'Download',
            html: renderScreenScraperDownloadCard(hasCreds, downloadError, summary),
        },
    ], true, defaultSubtab);
}

// 16x16 stroke icons (drawn with currentColor, so the caller's color class tints them). Each
// asset kind gets its own glyph: marquee = lit sign on a stand, flyer = folded sheet of paper,
// logo = star.
const ASSET_ICON_PATHS: { [kind: string]: string } = {
    Marquee: '<rect x="1.5" y="3" width="13" height="6" rx="1"/><path d="M8 9v3.5M5 13h6"/>',
    Flyer: '<path d="M4 1.5h5.5L13 5v9.5H4z"/><path d="M9.5 1.5V5H13M6 8.5h5M6 11h5"/>',
    Logo: '<path d="M8 1.8l1.8 3.8 4.2.5-3.1 2.9.8 4.1L8 11.1l-3.7 2 .8-4.1L2 6.1l4.2-.5z"/>',
};

const ICON_SVG_ATTRS = 'width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" '
    + 'stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"';

/**
 * One asset (marquee/flyer/logo) presence icon: green when the file exists, red when it doesn't.
 * A missing one is also struck through, so the state doesn't rest on red vs. green alone.
 */
function renderAssetIcon(kind: 'Marquee' | 'Flyer' | 'Logo', found: boolean): string {
    const label = `${kind}: ${found ? 'present' : 'missing'}`;
    return `<span class="asset-icon ${found ? 'badge-yes' : 'badge-no'}" title="${label}" role="img" aria-label="${label}">
        <svg ${ICON_SVG_ATTRS}>${ASSET_ICON_PATHS[kind]}${found ? '' : '<path d="M2 14L14 2"/>'}</svg>
    </span>`;
}

function renderAssetIcons(row: FavoriteMediaStatus): string {
    return `<span class="asset-icons">${renderAssetIcon('Marquee', row.hasMarquee)}${
        renderAssetIcon('Flyer', row.hasFlyer)}${renderAssetIcon('Logo', row.hasLogo)}</span>`;
}

/** Icon-only submit button; `label` is its tooltip and accessible name. */
function renderIconButton(label: string, svgPaths: string, tone: 'danger' | 'ok' | 'warn' = 'danger'): string {
    // danger (red) is the default: removing/deleting; ok (green): restoring/enabling; warn
    // (amber): switching something off without losing it.
    const toneClass = tone === 'danger' ? '' : ` icon-button-${tone}`;
    return `<button type="submit" class="icon-button${toneClass}" title="${escapeHtml(label)}" aria-label="${escapeHtml(label)}">
        <svg ${ICON_SVG_ATTRS}>${svgPaths}</svg>
    </button>`;
}

const TRASH_ICON_PATHS = '<path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.5h5.8l.6-8.5M7 7v4M9 7v4"/>';
const RESTORE_ICON_PATHS = '<path d="M3.5 8A4.5 4.5 0 1 1 5 11.3"/><path d="M3 4.5V8h3.5"/>';
const PLAY_ICON_PATHS = '<path d="M5 3l8 5-8 5z"/>';
const PAUSE_ICON_PATHS = '<path d="M5.5 3v10M10.5 3v10"/>';

/**
 * Splits a MAME description ("Ghosts'n Goblins (World? set 1)", sometimes with several
 * parenthesized groups like "(Japan) (Alt)") into the plain name and the parenthesized
 * region/revision info (kept with their own parentheses, each group separate), so the table
 * can show the short name and move the (often long) extra info into a tooltip instead of
 * widening the column.
 */
function splitGameName(fullname: string): { name: string; extra: string | null } {
    const groups = fullname.match(/\([^)]*\)/g);
    if (!groups) {
        return {name: fullname, extra: null};
    }
    const name = fullname.slice(0, fullname.indexOf('(')).trim();
    return {name, extra: groups.join(' ')};
}

function renderGameName(fullname: string): string {
    const {name, extra} = splitGameName(fullname);
    if (!extra) {
        return escapeHtml(name);
    }
    return `${escapeHtml(name)} <span class="info-icon" title="${escapeHtml(extra)}">
        <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
            <circle cx="8" cy="8" r="7" fill="none" stroke="currentColor" stroke-width="1.5"/>
            <circle cx="8" cy="4.5" r="1" fill="currentColor"/>
            <rect x="7.25" y="7" width="1.5" height="5" fill="currentColor"/>
        </svg>
    </span>`;
}

function renderDownloadSummary(summary: DownloadSummary): string {
    const parts = [
        `${summary.alreadyComplete} already complete`,
        `${summary.downloaded} file(s) downloaded`,
        `${summary.notFound} not found on ScreenScraper`,
        `${summary.noMedia} without available artwork`,
        `${summary.errors.length} error(s)`,
    ];
    const errorsHtml = summary.errors.length
        ? `<ul>${summary.errors.map(error => `<li>${escapeHtml(error)}</li>`).join('')}</ul>`
        : '';
    return `
        <p class="info flash">${escapeHtml(parts.join(' — '))}${summary.stoppedForQuota
            ? ' — stopped: ScreenScraper quota exceeded, try again later.'
            : ''}</p>
        ${errorsHtml}
    `;
}

/**
 * Bios column content: the parent romset (biosName, e.g. "pacman" for a puckman clone) and any
 * device romsets (deviceRoms, e.g. "ym2413") are distinct dependencies a favorite can be missing
 * independently of each other, so both show up here, comma-separated.
 */
function renderBiosCell(row: FavoriteRow): string {
    if (!row.cached) {
        return '<em>-</em>';
    }
    const parts = [...(row.biosName ? [row.biosName] : []), ...row.deviceRoms];
    return parts.length ? escapeHtml(parts.join(', ')) : '<em>-</em>';
}

function renderFavoritesCard(favoritesInfo: FavoritesInfo): string {
    const flash = `
        ${favoritesInfo.notice ? `<p class="info flash">${escapeHtml(favoritesInfo.notice)}</p>` : ''}
        ${favoritesInfo.warning ? `<p class="error flash">${escapeHtml(favoritesInfo.warning)}</p>` : ''}
    `;

    if (favoritesInfo.error) {
        return `
            <section class="card">
                <h2>Favorites</h2>
                ${flash}
                <p class="info">${escapeHtml(favoritesInfo.error)}</p>
            </section>
        `;
    }

    const rows = favoritesInfo.rows.map(row => `
        <tr>
            <td>${escapeHtml(row.romName)}</td>
            <td>${row.cached ? renderGameName(row.fullname) : `<em>${escapeHtml(row.romName)}</em>`}</td>
            <td>${renderBiosCell(row)}</td>
            <td class="center">${renderAssetIcons(row)}</td>
            <td class="center">
                <form method="post" action="/favorites/delete">
                    <input type="hidden" name="romName" value="${escapeHtml(row.romName)}">
                    ${renderIconButton('Remove from favorites', TRASH_ICON_PATHS)}
                </form>
            </td>
        </tr>
    `).join('');

    const unresolvedCount = favoritesInfo.rows.filter(row => !row.cached).length;
    const cacheStatus = favoritesInfo.cacheUpdatedAt
        ? `Names up to date as of ${escapeHtml(new Date(favoritesInfo.cacheUpdatedAt).toLocaleString('en-GB', {
            dateStyle: 'short', timeStyle: 'short',
        }))}.`
        : 'Names never updated.';

    return `
        <section class="card">
            <h2>Favorites (${favoritesInfo.rows.length})</h2>
            ${flash}
            <div class="info status-row">
                <span>${cacheStatus}${unresolvedCount
                    ? ` ${unresolvedCount} favorite(s) added since - not resolved yet.`
                    : ''}</span>
                <form method="post" action="/favorites/refresh">
                    <button type="submit">Update favorites</button>
                </form>
            </div>
            <div class="table-wrap">
                <table class="favorites-table">
                    <thead>
                        <tr>
                            <th>Shortname</th>
                            <th>Name</th>
                            <th>Bios / Devices</th>
                            <th class="center" title="Marquee, flyer, logo">Assets</th>
                            <th class="center"></th>
                        </tr>
                    </thead>
                    <tbody>${rows}</tbody>
                </table>
            </div>
            <p class="info">Removing a favorite deletes its entry from <code>favorites.ini</code> (the
            roms and artwork stay on disk). The change shows up on the cabinet the next time MAUI
            starts. Do not do it while a MAME game is open: MAME rewrites this file when it
            closes.</p>
            <p class="info">Assets: marquee, flyer and logo, in that order - green when the file is
            present, red (struck through) when it is missing. To download the missing artwork
            from ScreenScraper, use the button in the
            <a href="/screenscraper">ScreenScraper</a> tab.</p>
        </section>
    `;
}

interface RemovedFavoritesFlash {
    notice?: string;
    warning?: string;
}

function renderRemovedFavoritesCard(removed: RemovedFavorite[], flash: RemovedFavoritesFlash = {}): string {
    const messages = `
        ${flash.notice ? `<p class="info flash">${escapeHtml(flash.notice)}</p>` : ''}
        ${flash.warning ? `<p class="error flash">${escapeHtml(flash.warning)}</p>` : ''}
    `;
    if (!removed.length) {
        return `
            <section class="card">
                <h2>Removed favorites</h2>
                ${messages}
                <p class="info">No removed favorites yet.</p>
            </section>
        `;
    }

    const rows = removed.map(item => `
        <tr>
            <td>${escapeHtml(item.romName)}</td>
            <td>${renderGameName(item.fullname)}</td>
            <td>${escapeHtml(new Date(item.removedAt).toLocaleString('en-GB', {
                dateStyle: 'short', timeStyle: 'short',
            }))}</td>
            <td class="center">
                <form method="post" action="/favorites/restore">
                    <input type="hidden" name="romName" value="${escapeHtml(item.romName)}">
                    ${renderIconButton('Restore to favorites', RESTORE_ICON_PATHS, 'ok')}
                </form>
            </td>
        </tr>
    `).join('');

    return `
        <section class="card">
            <h2>Removed favorites (${removed.length})</h2>
            ${messages}
            <p class="info">Favorites removed from the Games tab stay here: "Restore" puts them
            back into <code>favorites.ini</code> in alphabetical order, exactly as MAME had written them.
            Same precaution as for removal: not while a MAME game is open.</p>
            <div class="table-wrap">
                <table class="favorites-table">
                    <thead>
                        <tr>
                            <th>Shortname</th>
                            <th>Name</th>
                            <th>Removed on</th>
                            <th class="center"></th>
                        </tr>
                    </thead>
                    <tbody>${rows}</tbody>
                </table>
            </div>
        </section>
    `;
}

// The Home carousel's category icons, embedded as text in this bundle (the BO has no access to
// the renderer's hashed asset files, and src/ is not shipped): keyed by file name without
// extension ("shooter", "_default"...), i.e. by getCategoryIconKey(), the same key the carousel
// derives its CSS class from.
const CATEGORY_ICONS: {[key: string]: string} = Object.fromEntries(
    Object.entries(import.meta.glob('./assets/categories/*.svg', {query: '?raw', import: 'default', eager: true}))
        .map(([path, svg]) => [basename(path, '.svg'), svg as string]),
);

interface BoCategoryGame {
    romName: string;
    fullname: string;
    year: number | null;
    studio: string;
    // Game.players: from Multiplayer.ini (via player_alt/player_sim), "1 player" when it says nothing.
    players: string;
}

interface BoCategory {
    name: string;
    iconKey: string;
    games: BoCategoryGame[];
}

/**
 * The categories the Home carousel shows (TTL twins merged, same as mergeTtlCategories(); the
 * dynamic "Hiscores Only" first when some game supports hiscores, like Home.vue), each with its
 * games, plus a last "No category" entry for the games genre.ini doesn't know. Read from the
 * database like the carousel does, so it is what the cabinet displays, not what genre.ini says.
 */
async function loadBoCategories(): Promise<BoCategory[]> {
    const categories = await Category.findAll({order: ['name'], include: [{model: Game, required: true}]});
    const toGame = (game: Game): BoCategoryGame => ({
        romName: game.romName,
        fullname: game.fullname || game.romName,
        year: game.year || null,
        studio: game.studio,
        players: game.players,
    });
    const byName = (a: {fullname: string}, b: {fullname: string}) => a.fullname.localeCompare(b.fullname);

    const result: BoCategory[] = mergeTtlCategories(categories).map(entry => {
        const ids = isMergedCategory(entry) ? entry.categoryIds : [entry.id_category];
        const games = categories.filter(category => ids.includes(category.id_category))
            .flatMap(category => category.games.map(toGame)).sort(byName);
        return {name: entry.name, iconKey: getCategoryIconKey(entry.name), games};
    });

    const hiscoreGames = await Game.findAll({where: {hi: true}});
    if (hiscoreGames.length) {
        result.unshift({
            name: HISCORES_ONLY_CATEGORY.name,
            iconKey: getCategoryIconKey(HISCORES_ONLY_CATEGORY.name),
            games: hiscoreGames.map(toGame).sort(byName),
        });
    }

    const uncategorized = (await Game.findAll()).filter(game => game.id_category == null);
    if (uncategorized.length) {
        result.push({name: 'No category', iconKey: '_default', games: uncategorized.map(toGame).sort(byName)});
    }
    return result;
}

/**
 * "Categories" subtab of the Games tab: one row per carousel category with its icon and game
 * count, unfolding into the list of its games. '' when the database can't be read (not migrated
 * yet - same race as /login), which hides the subtab rather than breaking the whole Games tab.
 */
async function renderCategoriesCard(): Promise<string> {
    let categories: BoCategory[];
    try {
        categories = await loadBoCategories();
    } catch {
        return '';
    }
    if (!categories.length) {
        return `
            <section class="card">
                <h2>Categories</h2>
                <p class="info">No game in the database yet.</p>
            </section>
        `;
    }
    const rows = categories.map(category => {
        const iconKey = category.iconKey in CATEGORY_ICONS ? category.iconKey : '_default';
        const games = category.games.map(game => {
            const meta = [game.year, game.studio, game.players].filter(Boolean).map(part => escapeHtml(String(part)));
            return `
            <li>${escapeHtml(decodeXmlEntities(game.fullname))}
                <span class="checkbox-row-detail">${escapeHtml(game.romName)}</span>
                <span class="category-game-meta">${meta.join(' · ')}</span></li>
        `;
        }).join('');
        return `
            <details class="category-row">
                <summary>
                    <img class="category-icon" src="/category-icons/${escapeHtml(iconKey)}.svg" alt="">
                    <span class="category-name">${escapeHtml(category.name)}</span>
                    <span class="category-count">${category.games.length} game${category.games.length === 1 ? '' : 's'}</span>
                </summary>
                <ul class="category-games">${games}</ul>
            </details>
        `;
    }).join('');
    return `
        <section class="card">
            <h2>Categories (${categories.length})</h2>
            <p class="info">Grouped like the cabinet's carousel: mame's "TTL *" twins are merged into
            their plain category, and "Hiscores Only" lists the games whose scores can be extracted
            (they also belong to their own category). Each game shows its year, studio and player
            count (from Multiplayer.ini).</p>
            ${rows}
        </section>
    `;
}

/**
 * Games tab: current favorites, and the ones removed from it (restorable). Both are always
 * present so a removed favorite stays reachable even when favorites.ini ends up empty (in which
 * case the first card is just the "no favorites" message).
 *
 * removedFlash/defaultSection: which of the two a response is "about" (see renderSubtabbedPage()).
 * A flash on favoritesInfo belongs to the first one, removedFlash to the second. categoriesHtml
 * (see renderCategoriesCard()) is the "Categories" subtab, absent when empty.
 */
function renderFavoritesPage(
    favoritesInfo: FavoritesInfo, removedFlash?: RemovedFavoritesFlash,
    defaultSection: 'list' | 'removed' = 'list', categoriesHtml = '',
): string {
    // A rom put back by another route (or by mame's own menu) since it was removed isn't
    // "removed" anymore - don't offer to restore what's already there.
    const {favoritesPath} = getMameLocations(getMameHomePath());
    const current = favoritesPath ? getFavoriteRomNames(favoritesPath) : [];
    const removed = readRemovedFavorites()
        .filter(item => !current.includes(item.romName))
        .sort((a, b) => b.removedAt.localeCompare(a.removedAt));

    return renderSubtabbedPage('favorites', [
        {id: 'list', label: 'Favorites', html: renderFavoritesCard(favoritesInfo)},
        ...(categoriesHtml ? [{id: 'categories', label: 'Categories', html: categoriesHtml}] : []),
        {id: 'removed', label: `Removed (${removed.length})`, html: renderRemovedFavoritesCard(removed, removedFlash)},
    ], true, defaultSection);
}

/**
 * Both import routes (manual upload and repo-url) shell out to
 * scripts/import-starting-pack.py - a fast, local `--version` probe, same synchronous-external-
 * process convention as getMameInfo()'s own execFileSync calls above, rather than an async
 * execFile callback.
 */
function isPython3Available(): boolean {
    try {
        execFileSync('python3', ['--version'], {stdio: 'ignore'});
        return true;
    } catch {
        return false;
    }
}

/**
 * Shown right above renderImportCard() wherever it renders (initial page load and both
 * post-import re-renders), so a missing python3 surfaces proactively instead of only once an
 * import is attempted.
 */
function renderPythonWarning(): string {
    if (isPython3Available()) {
        return '';
    }
    return '<p class="error flash">python3 not found on this machine - starting pack import '
        + 'is unavailable.</p>';
}

function renderImportCard(error?: string): string {
    return `
        <section class="card">
            <h2>Import a starting pack</h2>
            <p class="info">Fully replaces the games/roms/artwork present in
            the pack and adds its games to MAME's favorites (existing favorites are kept). Other
            games, players and scores are left untouched.</p>
            <p class="info">A ZIP can also contain only ${IMPORTABLE_MAME_DIRECTORIES
                .map(d => escapeHtml(d.zipFolder)).join(', ')} folders (copied as-is into the
            current mame configuration) - in that case, no manifest.json is needed.</p>
            ${error ? `<p class="error flash">${escapeHtml(error)}</p>` : ''}
            <form method="post" action="/import" enctype="multipart/form-data">
                <label for="pack">ZIP file</label>
                <input type="file" id="pack" name="pack" accept=".zip" required>
                <button type="submit">Import</button>
            </form>
        </section>
    `;
}

function humanFileSize(bytes: number): string {
    let size = bytes;
    for (const unit of ['B', 'KiB', 'MiB', 'GiB']) {
        if (size < 1024) {
            return `${size.toFixed(1)} ${unit}`;
        }
        size /= 1024;
    }
    return `${size.toFixed(1)} TiB`;
}

interface DiskSpace {
    path: string;
    freeBytes: number;
    totalBytes: number;
    // st_dev of the nearest existing ancestor - two paths with the same value share a
    // filesystem (a pack is downloaded to the OS temp dir, then extracted to the roms dir).
    deviceId: number;
}

/**
 * Free space (available to a non-root user) on the filesystem holding `path`, or null when it
 * can't be determined. Walks up to the nearest existing ancestor first: the roms directory may
 * not be created yet on a fresh MAME home. statfsSync is cross-platform (Node >= 18.15).
 */
function getDiskSpace(path: string): DiskSpace | null {
    let probe = path;
    while (!existsSync(probe)) {
        const parent = dirname(probe);
        if (parent === probe) {
            return null;
        }
        probe = parent;
    }
    try {
        const stats = statfsSync(probe);
        return {
            path,
            freeBytes: stats.bavail * stats.bsize,
            totalBytes: stats.blocks * stats.bsize,
            deviceId: statSync(probe).dev,
        };
    } catch {
        return null;
    }
}

// Walking a big roms folder (thousands of zips, CHD subfolders) is not free, and the MAME tab
// re-renders on every action - remember the last result for a short while.
const DIRECTORY_SIZE_CACHE_MS = 30_000;
const directorySizeCache = new Map<string, {bytes: number; at: number}>();

/**
 * Total size of the regular files under `path` (recursive, symlinks not followed), 0 when it
 * does not exist. Unreadable entries are skipped rather than failing the whole card.
 */
function getDirectorySize(path: string): number {
    const cached = directorySizeCache.get(path);
    if (cached && Date.now() - cached.at < DIRECTORY_SIZE_CACHE_MS) {
        return cached.bytes;
    }
    let bytes = 0;
    const pending = [path];
    while (pending.length) {
        const dir = pending.pop() as string;
        let entries;
        try {
            entries = readdirSync(dir, {withFileTypes: true});
        } catch {
            continue;
        }
        for (const entry of entries) {
            const entryPath = join(dir, entry.name);
            if (entry.isDirectory()) {
                pending.push(entryPath);
            } else if (entry.isFile()) {
                try {
                    bytes += lstatSync(entryPath).size;
                } catch {
                    // vanished between readdir and stat - ignore
                }
            }
        }
    }
    directorySizeCache.set(path, {bytes, at: Date.now()});
    return bytes;
}

/**
 * Combined size of the given folders, counting only those on the filesystem `deviceId` (the
 * bar is about that one disk) and never twice: a folder nested inside another listed one is
 * already part of it.
 */
function getInstalledContentBytes(paths: (string | null)[], deviceId: number): number {
    const onDisk = [...new Set(paths.filter((path): path is string => !!path))].filter(path => {
        try {
            return statSync(path).dev === deviceId;
        } catch {
            return false;
        }
    });
    return onDisk
        .filter(path => !onDisk.some(other => other !== path && path.startsWith(other.replace(/[\\/]+$/, '') + sep)))
        .reduce((total, path) => total + getDirectorySize(path), 0);
}

/**
 * Distinct, stable colour per pack (its index in the repository listing, not its tick order), so
 * the swatch beside a checkbox, its segment in the disk bar and its legend entry always match.
 * The golden angle spreads consecutive hues apart however many packs there are.
 */
function packColor(index: number): string {
    return `hsl(${Math.round((index * 137.508) % 360)}, 65%, 58%)`;
}

/**
 * Free-space block for the repository card: one bar over the total size of the disk holding the
 * roms - space already used in grey, then (filled in by the script in renderRepoPackPicker() as
 * games are ticked/unticked) one coloured segment per pack the selected games come from, with a
 * legend. A pack's segment is the extracted size of its selected games (rom zip + artwork, plus
 * each BIOS/parent set they need, once) +5% for filesystem block overhead, the same margin as the
 * import script's own preflight. Nothing is downloaded to a temporary file any more (the script
 * reads just what it needs from the pack with HTTP Range requests), so only this disk matters.
 */
function renderDiskSpaceInfo(mameInfo: MameInfo): string {
    const romPath = mameInfo.romPath;
    const roms = romPath ? getDiskSpace(romPath) : null;
    if (!roms) {
        return '';
    }
    const usedBytes = Math.max(0, roms.totalBytes - roms.freeBytes);
    // Part of the used space that is pack content already installed (roms + marquees/flyers/
    // logos, what a pack carries - its ini files are negligible), before any pack is added; the
    // rest being whatever else lives on the disk. Capped at the used total: these folders can
    // hold more than the filesystem reports as used (e.g. compressed/deduplicated storage).
    const romsBytes = Math.min(usedBytes, getInstalledContentBytes(
        [roms.path, mameInfo.marqueePath, mameInfo.flyerPath, mameInfo.logoPath], roms.deviceId,
    ));
    const otherBytes = usedBytes - romsBytes;
    const percentOf = (bytes: number): string => (
        roms.totalBytes > 0 ? Math.min(100, bytes / roms.totalBytes * 100) : 0
    ).toFixed(2);
    return `
        <div class="disk-space" data-total="${roms.totalBytes}" data-roms-free="${roms.freeBytes}">
            <p class="info">Disk space for the roms
            (<span class="current-path">${escapeHtml(roms.path)}</span>):
            <strong>${escapeHtml(humanFileSize(roms.freeBytes))}</strong> free of
            ${escapeHtml(humanFileSize(roms.totalBytes))}</p>
            <div class="disk-bar-track">
                <div class="disk-bar-used" style="width: ${percentOf(otherBytes)}%"
                    title="Other data: ${escapeHtml(humanFileSize(otherBytes))}"></div>
                <div class="disk-bar-roms" style="width: ${percentOf(romsBytes)}%"
                    title="Roms &amp; artwork already installed: ${escapeHtml(humanFileSize(romsBytes))}"></div>
            </div>
            <p class="disk-zoom-note" hidden></p>
            <ul class="disk-legend">
                <li class="disk-legend-static"><span class="pack-swatch disk-bar-used"></span>Other data
                    (${escapeHtml(humanFileSize(otherBytes))})</li>
                <li class="disk-legend-static"><span class="pack-swatch disk-bar-roms"></span>Roms &amp; artwork already installed
                    (${escapeHtml(humanFileSize(romsBytes))})</li>
            </ul>
            <p class="info disk-space-selection" hidden></p>
        </div>
    `;
}

/**
 * `<pack>.manifest.json` next to a pack's zip on the repository (see docs/STARTER-PACK-REPO.md):
 * the list of its games, which is all that is needed to tell what is already installed without
 * downloading the pack. null on any failure (missing file, timeout, invalid JSON): the pack is
 * then simply listed without that comparison instead of failing the whole browse.
 */
async function fetchRepoManifest(
    repoUrl: string, packFilename: string, authorization: string,
): Promise<StartingPackManifest | null> {
    if (!/^[\w.-]+\.zip$/.test(packFilename)) {
        return null;
    }
    try {
        const response = await fetch(`${repoUrl}/${packFilename.replace(/\.zip$/, '')}.manifest.json`, {
            headers: {Authorization: authorization},
            signal: AbortSignal.timeout(10_000),
        });
        return response.ok ? await response.json() as StartingPackManifest : null;
    } catch {
        return null;
    }
}

const MISSING_GAMES_SHOWN = 4;

function renderPackOwnership(ownership: PackOwnership | undefined): string {
    if (!ownership) {
        return '';
    }
    if (isPackFullyOwned(ownership)) {
        return `<span class="pack-status pack-status-owned">Already installed (${ownership.total}/${ownership.total} roms)</span>`;
    }
    if (ownership.owned === 0) {
        return '<span class="pack-status">Not installed yet</span>';
    }
    // Some of it is installed, the rest is new to this machine: an updated pack, or a partial import.
    const shown = ownership.missing.slice(0, MISSING_GAMES_SHOWN).map(escapeHtml).join(', ');
    const more = ownership.missing.length > MISSING_GAMES_SHOWN
        ? ` and ${ownership.missing.length - MISSING_GAMES_SHOWN} more` : '';
    return `<span class="pack-status pack-status-update">Update available: ${ownership.missing.length} new game(s)
        (${ownership.owned}/${ownership.total} roms installed) - ${shown}${more}</span>`;
}

const PACK_GAME_MARKS: {[status in PackGameDetail['status']]: {mark: string; title: string}} = {
    installed: {mark: '✓', title: 'Already installed'},
    new: {mark: '+', title: 'Not installed yet'},
    'no-rom': {mark: '·', title: 'No rom file of its own'},
};

/**
 * Expandable list of a pack's games. Each game that is not installed yet has its own checkbox
 * (`game`, value "<pack>|<romName>"): the import then takes only the ticked ones from that pack.
 * The same game listed by several packs is ticked everywhere at once (script in
 * renderRepoPackPicker()) and fetched from the first of them only. Rendered next to the pack's
 * <label>, never inside it: a click on a <summary> inside a <label> would also tick the pack's
 * checkbox. The "new" marks are only highlighted when part of the pack is already installed (an
 * update): for a pack never imported, every game being "new" is not worth a colour.
 */
function renderPackGames(pack: RepoPack, fullyOwned: boolean): string {
    if (!pack.games?.length) {
        return '';
    }
    const isUpdate = !!pack.ownership && pack.ownership.owned > 0 && !fullyOwned;
    const items = pack.games.map(game => {
        const {mark, title} = PACK_GAME_MARKS[game.status];
        const meta = [game.year, game.manufacturer && decodeXmlEntities(game.manufacturer), game.categoryName]
            .filter((part): part is string => !!part).map(escapeHtml).join(' · ');
        const label = `${escapeHtml(decodeXmlEntities(game.fullname))}
            ${meta ? `<span class="checkbox-row-detail">${meta}</span>` : ''}`;
        const classes = `pack-game pack-game-${game.status}${game.status === 'new' && isUpdate ? ' pack-game-highlight' : ''}`;
        // What the search box looks in (folded and matched in the page, see renderRepoPackPicker()).
        const search = escapeHtml([
            decodeXmlEntities(game.fullname), game.romName, game.manufacturer && decodeXmlEntities(game.manufacturer),
            game.categoryName, game.year,
        ].filter(Boolean).join(' '));
        if (game.status === 'installed' || fullyOwned) {
            return `
                <li class="${classes}" data-search="${search}">
                    <span class="pack-game-mark" title="${title}">${mark}</span>
                    <span>${label}</span>
                </li>
            `;
        }
        return `
            <li class="${classes}" data-search="${search}">
                <label class="pack-game-label">
                    <input type="checkbox" class="game-checkbox" name="game"
                        value="${escapeHtml(`${pack.filename}|${game.romName}`)}"
                        data-rom="${escapeHtml(game.romName)}" data-size="${game.size}"
                        data-bios="${escapeHtml(game.biosName ?? '')}">
                    <span>${label}</span>
                </label>
            </li>
        `;
    }).join('');
    return `
        <details class="pack-details">
            <summary>Games in this pack (${pack.games.length})</summary>
            <ul class="pack-games">${items}</ul>
        </details>
    `;
}

function renderRepoPackPicker(packs: RepoPack[]): string {
    if (!packs.length) {
        return '<p class="info flash">No pack available on this repository.</p>';
    }
    const rows = packs.map((pack, index) => {
        const details = [
            humanFileSize(pack.size),
            pack.gameCount !== undefined ? `${pack.gameCount} game(s)` : null,
            pack.generatedAt ? new Date(pack.generatedAt).toLocaleDateString('en-GB') : null,
        ].filter((part): part is string => part !== null).join(' — ');
        const color = packColor(index);
        // Everything in the pack is already installed: nothing to fetch, so it cannot be ticked.
        const owned = isPackFullyOwned(pack.ownership);
        // Without its manifest there is no list of games to pick from (the import needs the rom
        // names), so such a pack cannot be selected either.
        const unavailable = !pack.games?.length;
        return `
            <div class="pack-row" data-pack="${escapeHtml(pack.filename)}" data-color="${color}"
                data-bios-sizes="${escapeHtml(JSON.stringify(pack.biosSizes ?? {}))}">
            <label class="checkbox-row${owned || unavailable ? ' pack-owned' : ''}">
                <input type="checkbox" class="pack-toggle"${owned || unavailable ? ' disabled' : ''}>
                <span class="pack-swatch" style="background-color: ${color}"></span>
                <span>${escapeHtml(pack.filename)}<span class="checkbox-row-detail">${escapeHtml(details)}</span>
                    ${unavailable
                        ? '<span class="pack-status">Manifest unavailable - its games cannot be listed</span>'
                        : renderPackOwnership(pack.ownership)}</span>
            </label>
            ${renderPackGames(pack, owned)}
            </div>
        `;
    }).join('');
    // Submit stays disabled until at least one game is ticked (server re-checks either way).
    // The search box sits outside the form: Enter in it must not submit the import.
    return `
        <div class="pack-search">
            <input type="search" id="packSearch" placeholder="Search a game, studio or category…"
                autocomplete="off" aria-label="Search the games of the packs">
            <p class="info pack-search-count" id="packSearchCount" hidden></p>
        </div>
        <form method="post" action="/import/from-url"
            onsubmit="return confirm('This overwrites the roms and media of the selected games, then adds them to your MAME favorites without touching yours. Only these games are fetched from their pack. Continue?')">
            <p class="info">Tick a pack for all its games not installed yet, or open it to pick games one by one.
            A game listed by several packs is fetched once. While a search is active, the pack boxes and
            "Select all" only act on the games shown; ticked games stay ticked when they are hidden.</p>
            ${rows}
            <label class="checkbox-row">
                <input type="checkbox" id="packSelectAll">
                <span>Select all</span>
            </label>
            <button type="submit" id="packSubmit" disabled>Fetch and import</button>
        </form>
        <script>(function () {
            var rows = Array.prototype.slice.call(document.querySelectorAll('.pack-row'));
            var all = document.getElementById('packSelectAll');
            var submit = document.getElementById('packSubmit');
            var disk = document.querySelector('.disk-space');
            var summary = disk && disk.querySelector('.disk-space-selection');
            var track = disk && disk.querySelector('.disk-bar-track');
            var legend = disk && disk.querySelector('.disk-legend');
            var zoomNote = disk && disk.querySelector('.disk-zoom-note');
            var search = document.getElementById('packSearch');
            var searchCount = document.getElementById('packSearchCount');
            // Below this share of the disk, the selection is a sliver of the full bar (700 MB on
            // a 1 TB disk): the bar then shows only the free space instead of the whole disk.
            var ZOOM_BELOW = 0.02;
            function formatSize(bytes) {
                var units = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
                var i = 0;
                while (bytes >= 1024 && i < units.length - 1) { bytes /= 1024; i++; }
                return bytes.toFixed(1) + ' ' + units[i];
            }
            function gameBoxes(row) {
                return Array.prototype.slice.call(row.querySelectorAll('.game-checkbox:not([disabled])'));
            }
            var allBoxes = [].concat.apply([], rows.map(gameBoxes));
            // What a pack box / "Select all" acts on: the games a search leaves showing.
            function isShown(box) { return !box.closest('li').hidden; }
            function shownBoxes(row) { return gameBoxes(row).filter(isShown); }
            // Adds one segment to the bar and its entry to the legend.
            function addPart(bytes, total, label, color) {
                var seg = document.createElement('div');
                seg.className = 'disk-bar-seg';
                seg.style.width = (bytes / total * 100).toFixed(2) + '%';
                seg.style.backgroundColor = color;
                seg.title = label + ': ' + formatSize(bytes);
                track.appendChild(seg);
                var item = document.createElement('li');
                item.className = 'disk-legend-part';
                var swatch = document.createElement('span');
                swatch.className = 'pack-swatch';
                swatch.style.backgroundColor = color;
                item.appendChild(swatch);
                item.appendChild(document.createTextNode(label + ' (' + formatSize(bytes) + ')'));
                legend.appendChild(item);
            }
            // A game listed by several packs is only fetched from the first one (in page order)
            // that has it ticked: the size and legend entry go to that pack alone.
            function selection() {
                var seen = {};
                return rows.map(function (row) {
                    var bios = {};
                    var biosSizes = JSON.parse(row.dataset.biosSizes || '{}');
                    var bytes = 0;
                    var games = 0;
                    gameBoxes(row).forEach(function (box) {
                        if (!box.checked || seen[box.dataset.rom]) { return; }
                        seen[box.dataset.rom] = true;
                        games++;
                        bytes += Number(box.dataset.size);
                        var name = box.dataset.bios;
                        if (name && !bios[name]) {
                            bios[name] = true;
                            bytes += Number(biosSizes[name] || 0);
                        }
                    });
                    return {name: row.dataset.pack.replace(/[.]zip$/, ''), color: row.dataset.color, games: games, bytes: bytes};
                });
            }
            function refresh() {
                rows.forEach(function (row) {
                    var boxes = shownBoxes(row);
                    var ticked = boxes.filter(function (box) { return box.checked; }).length;
                    var toggle = row.querySelector('.pack-toggle');
                    toggle.checked = boxes.length > 0 && ticked === boxes.length;
                    toggle.indeterminate = ticked > 0 && ticked < boxes.length;
                });
                // The import takes every ticked game, shown or not.
                var pickedBoxes = allBoxes.filter(function (box) { return box.checked; });
                submit.disabled = pickedBoxes.length === 0;
                var shownAll = allBoxes.filter(isShown);
                all.checked = shownAll.length > 0 && shownAll.every(function (box) { return box.checked; });
                all.disabled = shownAll.length === 0;
                if (!summary) { return; }
                var total = Number(disk.dataset.total);
                var free = Number(disk.dataset.romsFree);
                var parts = selection().filter(function (part) { return part.games > 0; });
                var games = parts.reduce(function (sum, part) { return sum + part.games; }, 0);
                var fetched = parts.reduce(function (sum, part) { return sum + part.bytes; }, 0);
                // +5% for filesystem block overhead, like the import script's own preflight check.
                var needed = fetched * 1.05;
                var enough = needed <= free;

                Array.prototype.slice.call(track.querySelectorAll('.disk-bar-seg')).forEach(function (el) { el.remove(); });
                Array.prototype.slice.call(legend.querySelectorAll('.disk-legend-part')).forEach(function (el) { el.remove(); });
                // Zoomed: the bar spans the free space only (used segments hidden by CSS) and the
                // needed bytes are relative to it. Never when they do not fit - that overflow
                // has to show against the whole disk.
                var zoomed = needed > 0 && needed <= free && needed < total * ZOOM_BELOW;
                var scale = zoomed ? free : total;
                disk.classList.toggle('disk-zoomed', zoomed);
                zoomNote.hidden = !zoomed;
                zoomNote.textContent = 'Zoomed on the free space (' + formatSize(free)
                    + ') - the bar no longer shows the ' + formatSize(total) + ' disk as a whole.';
                if (scale > 0) {
                    parts.forEach(function (part) {
                        addPart(part.bytes * 1.05, scale, part.name + ', ' + part.games + ' game(s)', part.color);
                    });
                }
                track.classList.toggle('disk-bar-overflow', !enough);

                summary.hidden = games === 0;
                summary.className = 'disk-space-selection ' + (enough ? 'info' : 'error');
                summary.textContent = games + ' game(s) from ' + parts.length + ' pack(s): '
                    + formatSize(fetched) + ' to fetch, about ' + formatSize(needed)
                    + ' needed, ' + formatSize(Math.max(0, free - needed)) + ' left afterwards'
                    + (enough ? '.' : ' - not enough free disk space.');
            }
            // Ticking a game ticks the same game in every other pack that lists it.
            function mirror(box) {
                allBoxes.forEach(function (other) {
                    if (other.dataset.rom === box.dataset.rom) { other.checked = box.checked; }
                });
            }
            allBoxes.forEach(function (box) {
                box.addEventListener('change', function () { mirror(box); refresh(); });
            });
            rows.forEach(function (row) {
                row.querySelector('.pack-toggle').addEventListener('change', function (event) {
                    shownBoxes(row).forEach(function (box) { box.checked = event.target.checked; mirror(box); });
                    refresh();
                });
            });
            all.addEventListener('change', function () {
                allBoxes.filter(isShown).forEach(function (box) { box.checked = all.checked; mirror(box); });
                refresh();
            });

            // Search: every term must appear (accents and case ignored) in the game's name, rom
            // name, studio, category or year, or in its pack's name. A pack with no match is hidden,
            // one with matches opens on them; clearing the search puts the packs back as they were.
            function fold(text) {
                return text.normalize('NFD').replace(/[\\u0300-\\u036f]/g, '').toLowerCase();
            }
            var openBeforeSearch = null;
            function applySearch() {
                var terms = fold(search.value).split(/\\s+/).filter(Boolean);
                var searching = terms.length > 0;
                if (searching && openBeforeSearch === null) {
                    openBeforeSearch = rows.map(function (row) {
                        var details = row.querySelector('.pack-details');
                        return details ? details.open : false;
                    });
                }
                var games = 0;
                var packs = 0;
                rows.forEach(function (row, index) {
                    var packName = fold(row.dataset.pack);
                    var shown = 0;
                    Array.prototype.forEach.call(row.querySelectorAll('.pack-game'), function (item) {
                        var haystack = packName + ' ' + fold(item.dataset.search || '');
                        var match = terms.every(function (term) { return haystack.indexOf(term) >= 0; });
                        item.hidden = !match;
                        if (match) { shown++; }
                    });
                    row.hidden = searching && shown === 0;
                    var details = row.querySelector('.pack-details');
                    if (details) {
                        details.open = searching ? shown > 0 : (openBeforeSearch ? openBeforeSearch[index] : details.open);
                    }
                    games += shown;
                    if (shown > 0) { packs++; }
                });
                if (!searching) { openBeforeSearch = null; }
                searchCount.hidden = !searching;
                searchCount.textContent = games
                    ? games + ' game(s) found in ' + packs + ' pack(s).'
                    : 'No game matches this search.';
                refresh();
            }
            search.addEventListener('input', applySearch);
            search.addEventListener('keydown', function (event) {
                if (event.key === 'Enter') { event.preventDefault(); }
            });
            refresh();
        })();</script>
    `;
}

/**
 * Settings form (POST /repo/save) for repo.maui.afronob.com's basic-auth credentials, plus -
 * once repoUrl is set - a button to browse it (GET /import/from-url/packs) and, once packs have
 * been fetched, the picker itself. Admin-only, same gating as renderMameDangerZoneCard() (see
 * renderForm()): downloading and importing an arbitrary pack from a configured repo is no less
 * consequential than the manual upload form right above it.
 */
function renderRepoImportCard(
    config: Config, mameInfo: MameInfo, packs?: RepoPack[], error?: string, info?: string,
): string {
    return `
        <section class="card">
            <h2>Starting pack repository</h2>
            <p class="info">Browses and imports a starting pack directly from a password-protected
            HTTP repository (see docs/STARTER-PACK-REPO.md), without going through the upload
            (Import tab) - useful for a pack too large for a browser form.</p>
            ${error ? `<p class="error flash">${escapeHtml(error)}</p>` : ''}
            ${info ? `<p class="info flash">${escapeHtml(info)}</p>` : ''}
            <form method="post" action="/repo/save" novalidate>
                <label for="repoUrl">Repository URL</label>
                <input type="text" id="repoUrl" name="repoUrl" value="${escapeHtml(config.repoUrl)}"
                    placeholder="https://repo.maui.afronob.com" autocomplete="off">
                <label for="repoUser">Username</label>
                <input type="text" id="repoUser" name="repoUser" value="${escapeHtml(config.repoUser)}" autocomplete="off">
                <label for="repoPassword">Password</label>
                <input type="password" id="repoPassword" name="repoPassword" value="${escapeHtml(config.repoPassword)}" autocomplete="off">
                <button type="submit">Save</button>
            </form>
            ${config.repoUrl ? `
                ${renderDiskSpaceInfo(mameInfo)}
                <form method="get" action="/import/from-url/packs">
                    <button type="submit">Browse available packs</button>
                </form>
                ${packs ? renderRepoPackPicker(packs) : ''}
            ` : ''}
        </section>
    `;
}

function renderUserStatusBadge(active: boolean): string {
    return active ? '<span class="badge-yes">✓ active</span>' : '<span class="badge-no">✗ inactive</span>';
}

function renderCreateUserCard(error?: string): string {
    return `
        <section class="card">
            <h2>Add a player</h2>
            ${error ? `<p class="error flash">${escapeHtml(error)}</p>` : ''}
            <form method="post" action="/users/create">
                <label for="pseudo_3">Nickname, 3 letters (required, unique)</label>
                <input type="text" id="pseudo_3" name="pseudo_3" maxlength="3" required>
                <label for="realname">Name</label>
                <input type="text" id="realname" name="realname">
                <label for="email">Email</label>
                <input type="email" id="email" name="email">
                <label class="checkbox-row">
                    <input type="checkbox" name="active" checked>
                    Active
                </label>
                <button type="submit">Create</button>
            </form>
        </section>
    `;
}

function renderUsersListCard(users: User[], avatarFilenames: string[], error?: string, info?: string): string {
    const rows = users.map(user => {
        const avatarFilename = findAvatarFile(avatarFilenames, user.pseudo_3);
        const hasAvatar = avatarFilename !== undefined;
        return `
        <tr>
            <td class="center">
                <form method="post" action="/users/${user.id_user}/avatar" enctype="multipart/form-data">
                    <label class="avatar-upload" title="Change the avatar (PNG)">
                        ${hasAvatar
                            ? `<img class="avatar-thumb" src="/avatars/${encodeURIComponent(avatarFilename as string)}" alt="">`
                            : '<span class="avatar-thumb avatar-placeholder">＋</span>'}
                        <input type="file" name="avatar" accept="image/png" onchange="this.form.submit()">
                    </label>
                </form>
            </td>
            <td>${escapeHtml(user.pseudo_3)}</td>
            <td>${user.realname ? escapeHtml(user.realname) : '<em>-</em>'}</td>
            <td class="center">${renderUserStatusBadge(user.active)}</td>
            <td class="center">
                <div class="row-actions">
                    <form method="post" action="/users/${user.id_user}/toggle-active">
                        ${user.active
                            ? renderIconButton('Deactivate', PAUSE_ICON_PATHS, 'warn')
                            : renderIconButton('Activate', PLAY_ICON_PATHS, 'ok')}
                    </form>
                    <form method="post" action="/users/${user.id_user}/delete"
                        onsubmit="return confirm('Delete ${escapeHtml(user.pseudo_3)}? The nickname stays reserved and an administrator can restore it later.')">
                        ${renderIconButton('Delete player', TRASH_ICON_PATHS)}
                    </form>
                </div>
            </td>
        </tr>
    `;
    }).join('');

    return `
        <section class="card">
            <h2>Players (${users.length})</h2>
            ${error ? `<p class="error flash">${escapeHtml(error)}</p>` : ''}
            ${info ? `<p class="info flash">${escapeHtml(info)}</p>` : ''}
            <div class="table-wrap">
                <table class="favorites-table">
                    <thead>
                        <tr>
                            <th class="center">Avatar</th>
                            <th>Nickname</th>
                            <th>Name</th>
                            <th class="center">Status</th>
                            <th class="center"></th>
                        </tr>
                    </thead>
                    <tbody>${rows || '<tr><td colspan="5"><em>No players</em></td></tr>'}</tbody>
                </table>
            </div>
        </section>
    `;
}

interface UsersPageExtras {
    isAdmin: boolean;
    deleted: DeletedUserRow[];
    deletedInfo?: string;
    deletedError?: string;
}

/**
 * Deleted players, restorable by an administrator (POST /users/:id/restore). A deleted player is
 * only soft-deleted: the nickname stays reserved and their scores stay in the database (hidden
 * from the hiscore views), so restoring brings all of it back. Same idea as the favorites
 * "Removed" subtab.
 */
function renderDeletedUsersCard(
    deleted: DeletedUserRow[], avatarFilenames: string[], error?: string, info?: string,
): string {
    const messages = `
        ${error ? `<p class="error flash">${escapeHtml(error)}</p>` : ''}
        ${info ? `<p class="info flash">${escapeHtml(info)}</p>` : ''}
    `;
    if (!deleted.length) {
        return `
            <section class="card">
                <h2>Deleted players</h2>
                ${messages}
                <p class="info">No deleted players.</p>
            </section>
        `;
    }
    const rows = deleted.map(({user, scoreCount}) => {
        const avatarFilename = findAvatarFile(avatarFilenames, user.pseudo_3);
        return `
        <tr>
            <td class="center">${avatarFilename !== undefined
                ? `<img class="avatar-thumb" src="/avatars/${encodeURIComponent(avatarFilename)}" alt="">`
                : '<span class="avatar-thumb avatar-placeholder">-</span>'}</td>
            <td>${escapeHtml(user.pseudo_3)}</td>
            <td>${user.realname ? escapeHtml(user.realname) : '<em>-</em>'}</td>
            <td>${escapeHtml(new Date(user.deletionDate).toLocaleString('en-GB', {
                dateStyle: 'short', timeStyle: 'short',
            }))}</td>
            <td class="center">${scoreCount}</td>
            <td class="center">
                <div class="row-actions">
                    <form method="post" action="/users/${user.id_user}/restore"
                        onsubmit="return confirm('Restore ${escapeHtml(user.pseudo_3)} with ${scoreCount} score(s)? Only do it for the player who owns this nickname.')">
                        ${renderIconButton('Restore player', RESTORE_ICON_PATHS, 'ok')}
                    </form>
                    <form method="post" action="/users/${user.id_user}/purge"
                        onsubmit="return confirm('Permanently delete ${escapeHtml(user.pseudo_3)} and ${scoreCount} score(s) from the database? The nickname becomes free again. This cannot be undone.')">
                        ${renderIconButton('Delete permanently', TRASH_ICON_PATHS)}
                    </form>
                </div>
            </td>
        </tr>`;
    }).join('');

    return `
        <section class="card">
            <h2>Deleted players (${deleted.length})</h2>
            ${messages}
            <p class="info">A deleted player's nickname stays reserved: nobody can register it, so
            nobody inherits their scores. Restoring brings the player back with their scores and
            avatar; only restore a player for the person who owns the nickname. Deleting permanently
            removes the player, their scores and their avatar from the database for good, and frees
            the nickname.</p>
            <div class="table-wrap">
                <table class="favorites-table">
                    <thead>
                        <tr>
                            <th class="center">Avatar</th>
                            <th>Nickname</th>
                            <th>Name</th>
                            <th>Deleted on</th>
                            <th class="center">Scores</th>
                            <th class="center"></th>
                        </tr>
                    </thead>
                    <tbody>${rows}</tbody>
                </table>
            </div>
        </section>
    `;
}

function renderUsersPage(
    users: User[], avatarFilenames: string[], error?: string, info?: string, createError?: string,
    extras: UsersPageExtras = {isAdmin: false, deleted: []},
): string {
    // See renderForm()'s own defaultSubtab for why this is computed from which message was
    // actually passed for this response, not inferred client-side from scanning for .flash.
    // createError is kept separate from error/info (both list-card messages, e.g. from
    // toggle-active/delete/avatar upload) so a duplicate-pseudo error from /users/create lands
    // back on "Add", next to the form that produced it, instead of "Players".
    const defaultSubtab = createError !== undefined ? 'add'
        : (extras.deletedInfo !== undefined || extras.deletedError !== undefined) ? 'deleted'
            : (error !== undefined || info !== undefined) ? 'players'
                : undefined;
    const sections: Subsection[] = [
        {id: 'add', label: 'Add', html: renderCreateUserCard(createError)},
        {id: 'players', label: 'Players', html: renderUsersListCard(users, avatarFilenames, error, info)},
    ];
    // Restoring a deleted player is the administrator's call (the route rejects anyone else too).
    if (extras.isAdmin) {
        sections.push({
            id: 'deleted',
            label: `Deleted (${extras.deleted.length})`,
            html: renderDeletedUsersCard(extras.deleted, avatarFilenames, extras.deletedError, extras.deletedInfo),
        });
    }
    return renderSubtabbedPage('users', sections, true, defaultSubtab);
}

/**
 * Friendly message for the common User.create() failure modes (unique pseudo_3,
 * length validators) instead of a raw Sequelize error dump.
 */
function describeUserError(error: unknown): string {
    if (error instanceof UniqueConstraintError) {
        return 'A player with this nickname already exists.';
    }
    if (error instanceof ValidationError) {
        return error.errors.map(e => e.message).join(' ');
    }
    return error instanceof Error ? error.message : 'Unexpected error.';
}

function renderBrowsePage(target: PathField, currentDir: string, initialValue: string): string {
    let entries: string[] = [];
    let error: string|undefined;
    try {
        entries = readdirSync(currentDir, {withFileTypes: true})
            .filter(entry => entry.isDirectory())
            .map(entry => entry.name)
            .sort((a, b) => a.localeCompare(b));
    } catch {
        error = `Unable to read the folder "${currentDir}".`;
    }

    const parentDir = dirname(currentDir);
    const canGoUp = parentDir !== currentDir;
    // Only ever carries the one field being browsed - carrying the other one too (even as an
    // empty default) would blank it out on the page this returns to, since that page treats
    // a present-but-empty query param differently from an absent one (falls back to the saved
    // config/mame.ini value only when the param is absent).
    const carryQuery = `${target}=${encodeURIComponent(initialValue)}`;
    const navLink = (dir: string) => `/browse?target=${target}&path=${encodeURIComponent(dir)}&${carryQuery}`;
    const selectLink = (dir: string) => `/?${target}=${encodeURIComponent(dir)}`;

    const rows = entries.map(name => {
        const fullPath = join(currentDir, name);
        return `<li><a href="${navLink(fullPath)}">📁 ${escapeHtml(name)}</a></li>`;
    }).join('');

    return renderPage(`
        <section class="card">
            <h2>Choose a folder</h2>
            <p class="current-path">${escapeHtml(currentDir)}</p>
            ${error ? `<p class="error flash">${escapeHtml(error)}</p>` : ''}
            <p>
                <a class="button-link" href="${selectLink(currentDir)}">Choose this folder</a>
                ${canGoUp ? ` &nbsp; <a href="${navLink(parentDir)}">⬆ Parent folder</a>` : ''}
            </p>
            <ul class="browse-list">${rows || '<li><em>No subfolder</em></li>'}</ul>
            <p><a href="/?${carryQuery}">Cancel</a></p>
        </section>
    `);
}

export function startBoServer(port: number, onConfigured: () => void, onReset: () => void): Server {
    const app = express();
    app.use(express.urlencoded({extended: false}));
    // A fresh secret per server start (rather than a persisted one) invalidates every session on
    // restart - acceptable here since the BO already forces a full page reload/restart after any
    // action (/reset, /maui/import) that would matter, and avoids storing a secret on disk.
    app.use(session({
        secret: randomBytes(32).toString('hex'),
        resave: false,
        saveUninitialized: false,
        cookie: {maxAge: 7 * 24 * 60 * 60 * 1000},
    }));
    // The BO is reachable from the whole LAN (app.listen() has no host argument), so every route
    // below this guard requires a logged-in session except the login page itself and the static
    // assets it needs (background/logo) to render.
    const PUBLIC_PATHS = new Set(['/login', '/background.jpg', '/mame-logo.svg']);
    app.use((req, res, next) => {
        if (PUBLIC_PATHS.has(req.path) || req.session.boUserId) {
            next();
            return;
        }
        res.redirect('/login');
    });
    // Disk storage, not memory: the import route hands the upload straight to
    // scripts/import-starting-pack.py by path, which streams it instead of buffering it in RAM -
    // the whole reason that script exists (see its own docstring). The temp file is removed by
    // the /import handler once the script finishes.
    const upload = multer({
        storage: multer.diskStorage({
            destination: (_req, _file, cb) => cb(null, os.tmpdir()),
            filename: (_req, _file, cb) => cb(null, `${randomBytes(8).toString('hex')}.zip`),
        }),
        limits: {fileSize: 500 * 1024 * 1024},
    });
    const avatarUpload = multer({storage: multer.memoryStorage(), limits: {fileSize: 5 * 1024 * 1024}});
    // Single connection for the server's lifetime: sequelize-typescript's static model methods
    // (User.findAll(), etc.) bind to whichever Sequelize instance last registered the model, so
    // this must not be recreated per-request.
    createSequelize();

    app.get('/background.jpg', (req, res) => {
        res.sendFile('img/background.jpg', {root: getStaticPath()});
    });

    app.get('/category-icons/:key.svg', (req, res) => {
        const svg = CATEGORY_ICONS[req.params.key];
        if (!svg) {
            res.sendStatus(404);
            return;
        }
        res.type('image/svg+xml').set('Cache-Control', 'public, max-age=3600').send(svg);
    });

    app.get('/mame-logo.svg', (req, res) => {
        res.sendFile('img/mame-logo.svg', {root: getStaticPath()});
    });

    app.get('/login', (req, res) => {
        res.send(renderLoginPage());
    });

    app.post('/login', async (req, res) => {
        const username: string = (req.body.username || '').trim();
        const password: string = req.body.password || '';
        let boUser: BoUser | null;
        try {
            boUser = await BoUser.findOne({where: {username}});
        } catch {
            // Same "not migrated yet" race /users already handles: this early in a fresh
            // install, the Electron renderer's Init.vue may not have run Database.update() yet.
            res.status(503).send(renderLoginPage(
                'Database not initialized yet - launch the application once before signing in.',
            ));
            return;
        }
        if (!boUser || !bcrypt.compareSync(password, boUser.passwordHash)) {
            res.status(401).send(renderLoginPage('Incorrect username or password.'));
            return;
        }
        req.session.boUserId = boUser.id;
        req.session.boUsername = boUser.username;
        req.session.boRole = boUser.role;
        res.redirect('/');
    });

    app.post('/logout', (req, res) => {
        req.session.destroy(() => res.redirect('/login'));
    });

    app.get('/account', async (req, res) => {
        const boUser = await BoUser.findByPk(req.session.boUserId);
        if (!boUser) {
            req.session.destroy(() => res.redirect('/login'));
            return;
        }
        res.send(renderAccountPage(boUser.username, boUser.role));
    });

    app.post('/account/password', async (req, res) => {
        const boUser = await BoUser.findByPk(req.session.boUserId);
        if (!boUser) {
            req.session.destroy(() => res.redirect('/login'));
            return;
        }
        const currentPassword: string = req.body.currentPassword || '';
        const newPassword: string = req.body.newPassword || '';
        const confirmPassword: string = req.body.confirmPassword || '';

        if (!bcrypt.compareSync(currentPassword, boUser.passwordHash)) {
            res.status(401).send(renderAccountPage(boUser.username, boUser.role, 'Incorrect current password.'));
            return;
        }
        if (newPassword.length < 4) {
            res.status(422).send(renderAccountPage(
                boUser.username, boUser.role, 'The new password must be at least 4 characters long.',
            ));
            return;
        }
        if (newPassword !== confirmPassword) {
            res.status(422).send(renderAccountPage(
                boUser.username, boUser.role, 'The confirmation does not match the new password.',
            ));
            return;
        }

        boUser.passwordHash = bcrypt.hashSync(newPassword, 10);
        await boUser.save();
        res.send(renderAccountPage(boUser.username, boUser.role, undefined, 'Password updated.'));
    });

    app.get('/', (req, res) => {
        const config = new Config();
        config.load();
        const mamePath = typeof req.query.mamePath === 'string' ? req.query.mamePath : (config.mamePath || '');
        const mameInfo = getMameInfo(config);
        // Only set after browsing for it below "Dossier des plugins MAME" - not persisted until
        // its own form is submitted, same as mamePath above.
        if (typeof req.query.pluginsPath === 'string') {
            mameInfo.pluginsPath = req.query.pluginsPath;
        }
        res.send(renderForm(
            {mamePath}, mameInfo, req.session.boRole === 'admin',
        ));
    });

    app.get('/screenscraper', (req, res) => {
        const config = new Config();
        config.load();
        res.send(renderScreenScraperPage({
            ssDevId: config.ssDevId,
            ssDevPassword: config.ssDevPassword,
            ssSoftName: config.ssSoftName,
            ssUserId: config.ssUserId,
            ssUserPassword: config.ssUserPassword,
            bezelAspect: config.bezelAspect,
        }, hasScreenScraperCredentials(config)));
    });

    /**
     * Cache-backed favorites tab (see the comment inside), shared by GET /favorites and the
     * re-renders after POST /favorites/delete and /favorites/restore. `flash.section` is the
     * subtab the message belongs to (and the one shown on load).
     */
    const renderFavoritesTab = async (flash?: RemovedFavoritesFlash & {section: 'list' | 'removed'}): Promise<string> => {
        const categoriesHtml = await renderCategoriesCard();
        const config = new Config();
        config.load();
        const context = getFavoritesContext(config);
        const listFlash = flash?.section === 'list' ? flash : {};
        const removedFlash = flash?.section === 'removed' ? flash : undefined;

        if ('error' in context) {
            return renderFavoritesPage(
                {rows: [], error: context.error, ...listFlash}, removedFlash, flash?.section, categoriesHtml,
            );
        }

        // Reads names/BIOS from the favorites cache instead of resolving them live (each favorite
        // otherwise costs a blocking `mame -lx` process spawn - see resolveFavoriteRow()), so this
        // tab loads instantly regardless of favorites count. Media badges stay live either way
        // (getFavoriteMediaStatus() is a cheap fs check). See POST /favorites/refresh below for
        // the button that re-resolves everything and rewrites the cache.
        const cache = readFavoritesCache();
        const rows = context.romNames.map(romName => favoriteRowFromCache(context, romName, cache));
        return renderFavoritesPage(
            {rows, cacheUpdatedAt: cache?.updatedAt ?? null, ...listFlash}, removedFlash, flash?.section, categoriesHtml,
        );
    };

    app.get('/favorites', async (req, res) => {
        res.send(await renderFavoritesTab());
    });

    app.post('/favorites/delete', async (req, res) => {
        const romName: string = (req.body.romName || '').trim();
        // Same character set as parseFavorites()/getFavoriteRomNames(): anything else can't be
        // a favorite this tab lists.
        if (!/^[a-z0-9]+$/.test(romName)) {
            res.status(422).send(await renderFavoritesTab({section: 'list', warning: 'Invalid rom name.'}));
            return;
        }
        if (isMameConfigSessionAlive()) {
            res.status(409).send(await renderFavoritesTab({
                section: 'list',
                warning: 'MAME is open (Gamepads tab): close it first, it would rewrite favorites.ini.',
            }));
            return;
        }

        const {favoritesPath} = getMameLocations(getMameHomePath());
        if (!favoritesPath) {
            res.status(404).send(await renderFavoritesTab({section: 'list', warning: 'No favorites.ini file found.'}));
            return;
        }

        const removal = removeFavorite(readFileSync(favoritesPath, 'utf8'), romName);
        if (removal === null) {
            res.status(422).send(await renderFavoritesTab({
                section: 'list',
                warning: `Unable to remove "${romName}": entry not found or unexpected favorites.ini format.`,
            }));
            return;
        }

        // Saved before favorites.ini is rewritten: if this write fails the favorite is still
        // listed (worst case, a stale "removed" record the removed subtab hides), whereas the
        // other order could lose the entry for good.
        const cache = readFavoritesCache();
        writeRemovedFavorites([
            ...readRemovedFavorites().filter(item => item.romName !== romName),
            {
                romName,
                fullname: removal.entry.split('\n')[1]?.trim() || cache?.entries[romName]?.fullname || romName,
                removedAt: new Date().toISOString(),
                entry: removal.entry,
                cache: cache?.entries[romName],
            },
        ]);
        writeFileSync(favoritesPath, removal.content, 'utf8');

        // Drop the rom's cached name/BIOS too, keeping the rest of the cache (and its updatedAt)
        // as it was - restored later, it gets its cache entry back from the removed record.
        if (cache?.entries[romName]) {
            delete cache.entries[romName];
            writeFileSync(getFavoritesCachePath(), JSON.stringify(cache));
        }

        res.send(await renderFavoritesTab({
            section: 'list', notice: `"${romName}" removed from the favorites (find it again in the "Removed" tab).`,
        }));
    });

    app.post('/favorites/restore', async (req, res) => {
        const romName: string = (req.body.romName || '').trim();
        const removed = readRemovedFavorites();
        const item = removed.find(candidate => candidate.romName === romName);
        if (!item) {
            res.status(404).send(await renderFavoritesTab({section: 'removed', warning: `"${romName}" is not in the removed favorites.`}));
            return;
        }
        if (isMameConfigSessionAlive()) {
            res.status(409).send(await renderFavoritesTab({
                section: 'removed',
                warning: 'MAME is open (Gamepads tab): close it first, it would rewrite favorites.ini.',
            }));
            return;
        }

        const {favoritesPath} = getMameLocations(getMameHomePath());
        if (!favoritesPath) {
            res.status(404).send(await renderFavoritesTab({section: 'removed', warning: 'No favorites.ini file found.'}));
            return;
        }

        const updated = addFavorite(readFileSync(favoritesPath, 'utf8'), item.entry);
        // null = already listed (put back by mame's own menu in the meantime) or a corrupt saved
        // entry - tell the two apart so the message is accurate.
        if (updated === null && !getFavoriteRomNames(favoritesPath).includes(romName)) {
            res.status(422).send(await renderFavoritesTab({
                section: 'removed', warning: `Unable to restore "${romName}": the saved entry is invalid.`,
            }));
            return;
        }
        if (updated !== null) {
            writeFileSync(favoritesPath, updated, 'utf8');
        }

        // Written after favorites.ini for the reverse reason of /favorites/delete: a failure here
        // leaves the favorite restored (and merely still listed as removed until this rom is seen
        // in favorites.ini - the removed subtab hides it), never a favorite lost.
        writeRemovedFavorites(removed.filter(candidate => candidate.romName !== romName));
        if (item.cache) {
            const cache = readFavoritesCache();
            if (cache) {
                cache.entries[romName] = item.cache;
                writeFileSync(getFavoritesCachePath(), JSON.stringify(cache));
            }
        }

        res.send(await renderFavoritesTab({
            section: 'removed',
            notice: updated === null
                ? `"${romName}" was already in the favorites.`
                : `"${romName}" restored to the favorites.`,
        }));
    });

    app.post('/favorites/refresh', (req, res) => {
        const config = new Config();
        config.load();
        const context = getFavoritesContext(config);

        if ('error' in context) {
            res.send(renderFavoritesPage({rows: [], error: context.error}));
            return;
        }

        // Stream the page as favorites are resolved instead of blocking on the whole list: each
        // one is a blocking `mame -lx` process spawn (see resolveFavoriteRow()), so with enough
        // favorites the unstreamed version could take a long time to send anything at all -
        // same fix already applied to /favorites/download-media below.
        res.writeHead(200, {'Content-Type': 'text/html; charset=utf-8'});
        res.socket?.setNoDelay(true);
        res.write(renderPageHead('favorites'));
        res.write(`
            <section class="card">
                <h2>Updating favorites (${context.romNames.length})…</h2>
                ${PROGRESS_LOG_OPEN}
        `);

        const cacheEntries: { [romName: string]: FavoritesCacheEntry } = {};
        const rows: FavoriteRow[] = context.romNames.map((romName) => {
            const row = resolveFavoriteRow(context, romName);
            cacheEntries[romName] = {fullname: row.fullname, biosName: row.biosName, deviceRoms: row.deviceRoms};
            res.write(`<li>${escapeHtml(row.romName)} : ${escapeHtml(row.fullname)}</li>`);
            return row;
        });
        const cache = writeFavoritesCache(cacheEntries);

        res.write('</ul></section>');
        res.write(renderFavoritesCard({rows, cacheUpdatedAt: cache.updatedAt}));
        res.write(renderPageTail());
        res.end();
    });

    /**
     * Renders the Players tab. The deleted players (administrators only) are loaded here, on
     * every render, so each route below keeps showing an up-to-date "Deleted" subtab without
     * having to pass it along.
     */
    const usersPage = async (
        req: Request, users: User[], avatarFilenames: string[], error?: string, info?: string,
        createError?: string, messages: {deletedInfo?: string; deletedError?: string} = {},
    ): Promise<string> => {
        const isAdmin = req.session.boRole === 'admin';
        const deleted = isAdmin ? await listDeletedUsers().catch(() => []) : [];
        return renderUsersPage(users, avatarFilenames, error, info, createError, {isAdmin, deleted, ...messages});
    };

    app.get('/users', async (req, res) => {
        const avatarFilenames = getAvatarFilenames(new Config());
        try {
            const users = await User.findAll({order: [['pseudo_3', 'ASC']]});
            res.send(await usersPage(req, users, avatarFilenames));
        } catch {
            res.send(await usersPage(req, [], avatarFilenames, 'Database not found or not initialized yet - '
                + 'launch the application once before managing players.'));
        }
    });

    app.post('/users/create', async (req, res) => {
        const pseudo3: string = (req.body.pseudo_3 || '').trim().toUpperCase();
        const realname: string = (req.body.realname || '').trim();
        const email: string = (req.body.email || '').trim();
        const active = req.body.active === 'on';
        const config = new Config();

        try {
            // A deleted player's nickname stays reserved (see UserReservation.ts), whoever asks.
            if (await findDeletedUser(pseudo3)) {
                const users = await User.findAll({order: [['pseudo_3', 'ASC']]});
                res.status(422).send(await usersPage(
                    req, users, getAvatarFilenames(config), undefined, undefined,
                    `The nickname "${pseudo3}" belongs to a deleted player and is reserved. An administrator `
                    + 'can restore that player from the "Deleted" tab.',
                ));
                return;
            }
            await User.create({
                pseudo_3: pseudo3,
                ...(realname ? {realname} : {}),
                ...(email ? {email} : {}),
                active,
            } as User);
            // Every new player starts with a generated default avatar (see DefaultAvatar.ts); the
            // list below is read after this so it shows it. An avatar failing to write must not
            // turn a successful creation into an error page.
            try {
                ensureDefaultAvatar(config.avatarsPath, pseudo3);
            } catch (avatarError) {
                console.error(`[boServer] Default avatar for "${pseudo3}" failed:`, avatarError);
            }
            const users = await User.findAll({order: [['pseudo_3', 'ASC']]});
            res.send(await usersPage(req, 
                users, getAvatarFilenames(config), undefined, `Player "${pseudo3}" created.`,
            ));
        } catch (error) {
            const users = await User.findAll({order: [['pseudo_3', 'ASC']]}).catch(() => []);
            res.status(422).send(await usersPage(req, 
                users, getAvatarFilenames(config), undefined, undefined, describeUserError(error),
            ));
        }
    });

    app.post('/users/:id/toggle-active', async (req, res) => {
        const user = await User.findByPk(req.params.id);
        if (user) {
            user.active = !user.active;
            await user.save();
        }
        const users = await User.findAll({order: [['pseudo_3', 'ASC']]});
        res.send(await usersPage(req, 
            users, getAvatarFilenames(new Config()), undefined,
            user ? `Player "${user.pseudo_3}" updated.` : undefined,
        ));
    });

    app.post('/users/:id/delete', async (req, res) => {
        const user = await User.findByPk(req.params.id);
        if (user) {
            // Soft delete (User is paranoid): the nickname stays reserved and the scores are kept,
            // hidden from the hiscore views, until an administrator restores the player.
            await user.destroy();
        }
        const users = await User.findAll({order: [['pseudo_3', 'ASC']]});
        res.send(await usersPage(
            req, users, getAvatarFilenames(new Config()), undefined,
            user ? `Player "${user.pseudo_3}" deleted. The nickname stays reserved; an administrator can `
                + 'restore it from the "Deleted" tab.' : undefined,
        ));
    });

    app.post('/users/:id/purge', async (req, res) => {
        if (req.session.boRole !== 'admin') {
            res.status(403).send('Action reserved to administrators.');
            return;
        }
        const purged = await purgeDeletedUser(String(req.params.id), new Config().avatarsPath);
        const users = await User.findAll({order: [['pseudo_3', 'ASC']]});
        res.send(await usersPage(
            req, users, getAvatarFilenames(new Config()), undefined, undefined, undefined,
            purged
                ? {deletedInfo: `Player "${purged.user.pseudo_3}" permanently deleted, with ${purged.scoreCount} score(s).`}
                : {deletedError: 'This player is not among the deleted players (already removed?).'},
        ));
    });

    app.post('/users/:id/restore', async (req, res) => {
        if (req.session.boRole !== 'admin') {
            res.status(403).send('Action reserved to administrators.');
            return;
        }
        const restored = await restoreDeletedUser(String(req.params.id));
        const users = await User.findAll({order: [['pseudo_3', 'ASC']]});
        res.send(await usersPage(
            req, users, getAvatarFilenames(new Config()), undefined, undefined, undefined,
            restored
                ? {deletedInfo: `Player "${restored.pseudo_3}" restored, with their scores.`}
                : {deletedError: 'This player is not among the deleted players (already restored?).'},
        ));
    });

    app.post('/users/:id/avatar', avatarUpload.single('avatar'), async (req, res) => {
        // String(): with a middleware ahead of the handler @types/express 5 no longer infers the
        // route's params from the path, and req.params.id falls back to string | string[].
        const user = await User.findByPk(String(req.params.id));
        const users = await User.findAll({order: [['pseudo_3', 'ASC']]}).catch(() => []);
        const config = new Config();

        if (!user) {
            res.status(404).send(await usersPage(req, users, getAvatarFilenames(config), 'Player not found.'));
            return;
        }
        if (!req.file) {
            res.status(422).send(
                await usersPage(req, users, getAvatarFilenames(config), 'No file sent.'),
            );
            return;
        }
        if (req.file.mimetype !== 'image/png') {
            res.status(422).send(await usersPage(req, 
                users, getAvatarFilenames(config), 'The avatar must be a PNG image.',
            ));
            return;
        }

        writeFileSync(join(config.avatarsPath, `${user.pseudo_3}.png`), req.file.buffer);
        // The uploaded PNG replaces the generated default, which would only be left unused.
        rmSync(join(config.avatarsPath, `${user.pseudo_3}.svg`), {force: true});
        res.send(await usersPage(req, 
            users, getAvatarFilenames(config), undefined, `Avatar updated for "${user.pseudo_3}".`,
        ));
    });

    app.get('/avatars/:filename', (req, res) => {
        const config = new Config();
        // basename() strips any directory components (e.g. "../../etc/passwd") from the
        // user-controlled route param before it ever reaches the filesystem.
        const filename = basename(req.params.filename);
        if (!existsSync(join(config.avatarsPath, filename))) {
            res.status(404).end();
            return;
        }
        // Served with a `root`, not as an absolute path: Express 5's send() answers 404 for any
        // absolute path holding a dot directory, and the avatars live under ~/.mame-awesome-ui.
        // With a root only the part below it is checked. Same reason for res.download() below.
        res.sendFile(filename, {root: config.avatarsPath}, (error) => {
            if (error && !res.headersSent) {
                res.status(404).end();
            }
        });
    });

    app.post('/favorites/download-media', async (req, res) => {
        const config = new Config();
        config.load();
        const ssValues: ScreenScraperValues = {
            ssDevId: config.ssDevId,
            ssDevPassword: config.ssDevPassword,
            ssSoftName: config.ssSoftName,
            ssUserId: config.ssUserId,
            ssUserPassword: config.ssUserPassword,
            bezelAspect: config.bezelAspect,
        };
        const hasCreds = hasScreenScraperCredentials(config);
        const context = getFavoritesContext(config);

        if ('error' in context) {
            res.send(renderScreenScraperPage(ssValues, hasCreds, undefined, undefined, context.error));
            return;
        }

        // Only romName + media status is needed here (see downloadMissingFavoriteMedia() below) -
        // a cheap fs check, unlike resolveFavoriteRow()'s `mame -lx` spawn per rom, which this
        // route has no use for (progress lines below only ever print row.romName).
        const rows = context.romNames.map(romName => ({romName, ...getFavoriteMediaStatus(context, romName)}));

        if (!hasCreds) {
            res.send(renderScreenScraperPage(ssValues, false));
            return;
        }

        const {marqueePath, flyerPath, logoPath} = context;
        if (!marqueePath || !flyerPath || !logoPath) {
            res.send(renderScreenScraperPage(
                ssValues, hasCreds, undefined, undefined,
                'Marquees/flyers/logos folders not found - configure and validate the mame binary '
                    + '(MAME tab > Config).',
            ));
            return;
        }

        // Stream the page as favorites are processed instead of blocking on the whole batch:
        // each game appends a <li> the browser renders immediately, so long runs stay visible
        // instead of looking like the request (and the tab) hung.
        res.writeHead(200, {'Content-Type': 'text/html; charset=utf-8'});
        // Disable Nagle's algorithm so each res.write() below reaches the browser as soon as
        // it's flushed, instead of being buffered and coalesced with the next one.
        res.socket?.setNoDelay(true);
        res.write(renderPageHead('screenscraper'));
        res.write(`
            <section class="card">
                <h2>Download in progress…</h2>
                ${PROGRESS_LOG_OPEN}
        `);

        try {
            const summary = await downloadMissingFavoriteMedia(
                {
                    devId: config.ssDevId,
                    devPassword: config.ssDevPassword,
                    softName: config.ssSoftName,
                    userId: config.ssUserId,
                    userPassword: config.ssUserPassword,
                },
                marqueePath,
                flyerPath,
                logoPath,
                rows,
                line => res.write(`<li>${escapeHtml(line)}</li>`),
            );

            res.write('</ul></section>');
            res.write(renderDownloadSummary(summary));
        } catch (error) {
            console.error('[boServer] ScreenScraper download failed:', error);
            res.write(`</ul><p class="error">${
                escapeHtml(error instanceof Error ? error.message : 'Unexpected error.')
            }</p>`);
        }

        res.write('<p><a class="button-link" href="/screenscraper">Back to ScreenScraper</a></p>');
        res.write(renderPageTail());
        res.end();
    });

    // Starting packs are MAME-only content, imported from the MAME tab (see renderForm()) -
    // kept as a redirect rather than a 404 for anyone with the old standalone page bookmarked.
    app.get('/import', (req, res) => {
        res.redirect('/');
    });

    app.post('/import', upload.single('pack'), async (req, res) => {
        const config = new Config();
        config.load();
        const values: ConfigFormValues = {mamePath: config.mamePath || ''};
        const isAdmin = req.session.boRole === 'admin';

        if (!req.file) {
            res.status(400).send(renderForm(
                values, getMameInfo(config), isAdmin, undefined, undefined, undefined, 'No file received.',
            ));
            return;
        }

        // A clear BO-rendered error instead of a raw ENOENT surfacing from spawn() below - macOS
        // in particular doesn't always ship a working python3 without Xcode CLT installed.
        if (!isPython3Available()) {
            rmSync(req.file.path, {force: true});
            res.status(500).send(renderForm(
                values, getMameInfo(config), isAdmin, undefined, undefined, undefined,
                'python3 not found on this machine - unable to import a starting pack.',
            ));
            return;
        }

        res.writeHead(200, {'Content-Type': 'text/html; charset=utf-8'});
        res.socket?.setNoDelay(true);
        res.write(renderPageHead('mame'));

        // Validation (manifest.json/IMPORTABLE_MAME_DIRECTORIES, MAME config completeness) and
        // the actual import both happen inside the script now - it mirrors this same logic and
        // reports failures through its own stdout/stderr lines, same as /import/from-url below.
        const started = await runImportScript(res, 'Import in progress…', [req.file.path], {...process.env});
        rmSync(req.file.path, {force: true});
        if (!started) {
            return;
        }

        // Rest of the MAME tab, re-rendered fresh so e.g. the genre.ini/Multiplayer.ini fields
        // above reflect what the import just installed, instead of a "Retour" link to a
        // separate page.
        const refreshedMameInfo = getMameInfo(config);
        res.write(renderConfigCard(values, req.session.boRole === 'admin'));
        res.write(renderMameInfoCard(refreshedMameInfo));
        // Same gating as renderForm(): import only makes sense once the binary's configured and
        // validated (see there for why).
        if (!refreshedMameInfo.error) {
            res.write(renderPythonWarning());
            res.write(renderImportCard());
        }
        res.write(renderPageTail());
        res.end();
    });

    // Same admin gating as renderRepoImportCard()'s visibility in renderForm(): configuring where
    // packs come from, and importing an arbitrary one from there, is no less consequential than
    // the manual upload right above it.
    app.post('/repo/save', (req, res) => {
        if (req.session.boRole !== 'admin') {
            res.status(403).send('Action reserved to administrators.');
            return;
        }
        const config = new Config();
        config.load();
        // Trailing slash trimmed once here so every consumer (index.json fetch, pack download
        // URL) can always join with a bare '/', instead of each guarding against a possible
        // double slash.
        config.repoUrl = (req.body.repoUrl || '').trim().replace(/\/+$/, '');
        config.repoUser = (req.body.repoUser || '').trim();
        config.repoPassword = (req.body.repoPassword || '').trim();
        config.save();

        const values: ConfigFormValues = {mamePath: config.mamePath || ''};
        res.send(renderForm(
            values, getMameInfo(config), true, undefined, undefined, undefined, undefined, undefined,
            undefined, undefined, undefined, 'Repository configuration saved.',
        ));
    });

    // Proxied server-side (rather than the browser fetching index.json directly) so the repo's
    // basic-auth credentials never need to reach the browser at all.
    app.get('/import/from-url/packs', async (req, res) => {
        if (req.session.boRole !== 'admin') {
            res.status(403).send('Action reserved to administrators.');
            return;
        }
        const config = new Config();
        config.load();
        const values: ConfigFormValues = {mamePath: config.mamePath || ''};
        const mameInfo = getMameInfo(config);

        if (!config.repoUrl) {
            res.status(422).send(renderForm(
                values, mameInfo, true, undefined, undefined, undefined, undefined, undefined, undefined,
                undefined, 'Enter the repository URL before browsing it.',
            ));
            return;
        }

        try {
            const response = await fetch(`${config.repoUrl}/index.json`, {
                headers: {
                    Authorization: 'Basic '
                        + Buffer.from(`${config.repoUser}:${config.repoPassword}`).toString('base64'),
                },
            });
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }
            const data = await response.json() as {packs?: RepoPack[]};
            const packs = data.packs ?? [];
            const installedRoms = mameInfo.romPath ? listRomNames(mameInfo.romPath) : [];
            const authorization = 'Basic '
                + Buffer.from(`${config.repoUser}:${config.repoPassword}`).toString('base64');
            await Promise.all(packs.map(async pack => {
                const [manifest, entrySizes] = await Promise.all([
                    fetchRepoManifest(config.repoUrl, pack.filename, authorization),
                    // Per-game sizes for the disk bar, from the ZIP's central directory alone
                    // (two small range requests) - null if the server cannot do ranges.
                    /^[\w.-]+\.zip$/.test(pack.filename)
                        ? fetchRemoteZipEntrySizes(`${config.repoUrl}/${pack.filename}`, {Authorization: authorization})
                        : Promise.resolve(null),
                ]);
                pack.ownership = computePackOwnership(manifest, installedRoms) ?? undefined;
                pack.games = listPackGames(manifest, installedRoms, entrySizes, pack.size);
                pack.biosSizes = computeBiosSizes(manifest, entrySizes);
            }));
            res.send(renderForm(
                values, mameInfo, true, undefined, undefined, undefined, undefined, undefined, undefined,
                packs,
            ));
        } catch (error) {
            const message = error instanceof Error ? error.message : 'unexpected error';
            res.status(502).send(renderForm(
                values, mameInfo, true, undefined, undefined, undefined, undefined, undefined, undefined,
                undefined, `Unable to reach the repository: ${message}`,
            ));
        }
    });

    app.post('/import/from-url', async (req, res) => {
        if (req.session.boRole !== 'admin') {
            res.status(403).send('Action reserved to administrators.');
            return;
        }
        const config = new Config();
        config.load();
        const values: ConfigFormValues = {mamePath: config.mamePath || ''};
        const mameInfo = getMameInfo(config);
        // One "<pack>.zip|<romName>" per ticked game, grouped by pack (a game listed by several
        // packs is kept for the first). urlencoded (extended: false) yields a string for one
        // ticked box, an array for several; anything malformed is refused (see the function).
        const selection = groupSelectedGames(req.body?.game);

        if (!config.repoUrl) {
            res.status(422).send(renderForm(
                values, mameInfo, true, undefined, undefined, undefined, undefined, undefined, undefined,
                undefined, 'Repository URL not configured.',
            ));
            return;
        }
        if (selection && !selection.size) {
            res.status(422).send(renderForm(
                values, mameInfo, true, undefined, undefined, undefined, undefined, undefined, undefined,
                undefined, 'Tick at least one game to import.',
            ));
            return;
        }
        if (!selection) {
            res.status(422).send(renderForm(
                values, mameInfo, true, undefined, undefined, undefined, undefined, undefined, undefined,
                undefined, 'Invalid pack or game name.',
            ));
            return;
        }
        // A clear BO-rendered error instead of a raw ENOENT surfacing from spawn() below -
        // macOS in particular doesn't always ship a working python3 without Xcode CLT installed.
        if (!isPython3Available()) {
            res.status(500).send(renderForm(
                values, mameInfo, true, undefined, undefined, undefined, undefined, undefined, undefined,
                undefined, 'python3 not found on this machine - unable to import from the repository.',
            ));
            return;
        }

        res.writeHead(200, {'Content-Type': 'text/html; charset=utf-8'});
        res.socket?.setNoDelay(true);
        res.write(renderPageHead('mame'));

        // Packs are imported one after the other (one script run each, one progress card each):
        // the script rewrites favorites.ini and shared category files, so runs must not overlap.
        // Credentials go through env, never argv, so they don't leak via `ps`/
        // `/proc/<pid>/cmdline` (they already sit in Config's plaintext JSON file at the same
        // trust level as ssDevPassword).
        for (const [index, [packFilename, romNames]] of [...selection.entries()].entries()) {
            const counter = selection.size > 1 ? `[${index + 1}/${selection.size}] ` : '';
            // --only: just these games are read from the pack (HTTP Range requests, no full download).
            const started = await runImportScript(
                res,
                `${counter}Import from the repository in progress… (${escapeHtml(packFilename)}, ${romNames.length} game(s))`,
                ['--url', `${config.repoUrl}/${packFilename}`, '--only', romNames.join(','), '-y'],
                {...process.env, MAUI_REPO_USER: config.repoUser, MAUI_REPO_PASSWORD: config.repoPassword},
                {index, total: selection.size},
            );
            // false = launch failure, runImportScript already closed the response.
            if (!started) {
                return;
            }
        }

        const refreshedMameInfo = getMameInfo(config);
        res.write(renderConfigCard(values, req.session.boRole === 'admin'));
        res.write(renderMameInfoCard(refreshedMameInfo));
        if (!refreshedMameInfo.error) {
            res.write(renderPythonWarning());
            res.write(renderImportCard());
            res.write(renderRepoImportCard(config, refreshedMameInfo));
        }
        res.write(renderPageTail());
        res.end();
    });

    app.get('/maui', async (req, res) => {
        const config = new Config();
        config.load();
        await sendMauiPage(req, res, config);
    });

    app.post('/maui/save', async (req, res) => {
        const config = new Config();
        config.load();
        config.openDevTools = req.body.openDevTools === 'on';
        config.fullscreen = req.body.fullscreen === 'on';
        config.save();
        await sendMauiPage(req, res, config, {mauiInfo: 'Configuration saved.'});
    });

    // Backup/restore of mame-awesome-ui's own config/database - admin only (see the "Import /
    // export mame-awesome-ui" card, hidden from non-admins in renderMauiPage()).
    app.get('/maui/export', async (req, res) => {
        if (req.session.boRole !== 'admin') {
            res.status(403).send('Action reserved to administrators.');
            return;
        }
        const config = new Config();
        const exportConfigFile = req.query.json === 'on';
        const exportDatabase = req.query.db === 'on';

        if (!exportConfigFile && !exportDatabase) {
            config.load();
            await sendMauiPage(req, res, config, {
                importExportError: 'Tick at least one box (JSON and/or DB) before exporting.',
            });
            return;
        }

        const files: {path: string; name: string}[] = [];
        if (exportConfigFile && existsSync(config.configPath)) {
            files.push({path: config.configPath, name: basename(config.configPath)});
        }
        if (exportDatabase && existsSync(getDatabasePath())) {
            files.push({path: getDatabasePath(), name: basename(getDatabasePath())});
        }

        if (!files.length) {
            config.load();
            await sendMauiPage(req, res, config, {
                importExportError: 'Nothing to export: the selected file(s) do not exist yet.',
            });
            return;
        }

        if (files.length === 1) {
            // `root`, not the absolute path: send() refuses (404) paths with a dot directory such
            // as ~/.mame-awesome-ui (see the avatars route).
            res.download(basename(files[0].path), files[0].name, {root: dirname(files[0].path)});
            return;
        }

        const zip = new AdmZip();
        files.forEach(file => zip.addLocalFile(file.path));
        const date = new Date().toISOString().slice(0, 10);
        res.set('Content-Type', 'application/zip');
        res.set('Content-Disposition', `attachment; filename="mame-awesome-ui-export-${date}.zip"`);
        res.send(zip.toBuffer());
    });

    app.post('/maui/import', upload.single('file'), async (req, res) => {
        if (req.session.boRole !== 'admin') {
            res.status(403).send('Action reserved to administrators.');
            return;
        }
        const config = new Config();
        config.load();

        if (!req.file) {
            await sendMauiPage(req, res, config, {importExportError: 'No file provided.'});
            return;
        }

        const originalName = req.file.originalname.toLowerCase();
        const restored: string[] = [];

        try {
            if (originalName.endsWith('.zip')) {
                const zip = new AdmZip(req.file.buffer);
                const configEntry = zip.getEntries()
                    .find(entry => basename(entry.entryName) === 'mame-awesome-ui-config.json');
                const dbEntry = zip.getEntries()
                    .find(entry => basename(entry.entryName) === 'mame-awesome-ui.sqlite');

                if (!configEntry && !dbEntry) {
                    await sendMauiPage(req, res, config, {
                        importExportError: 'The ZIP contains neither mame-awesome-ui-config.json nor '
                            + 'mame-awesome-ui.sqlite.',
                    });
                    return;
                }
                if (configEntry) {
                    writeFileSync(config.configPath, configEntry.getData());
                    restored.push('the configuration');
                }
                if (dbEntry) {
                    writeFileSync(getDatabasePath(), dbEntry.getData());
                    restored.push('the database');
                }
            } else if (originalName.endsWith('.json')) {
                // Throws on malformed JSON, caught below - avoids overwriting the current
                // config with a file the app would then fail to load on next start.
                JSON.parse(req.file.buffer.toString('utf8'));
                writeFileSync(config.configPath, req.file.buffer);
                restored.push('the configuration');
            } else if (originalName.endsWith('.sqlite') || originalName.endsWith('.db')) {
                // Same sqlite file header every real .sqlite file starts with - cheap sanity
                // check against uploading an unrelated file under this extension.
                if (req.file.buffer.subarray(0, 16).toString('utf8') !== 'SQLite format 3\0') {
                    await sendMauiPage(req, res, config, {
                        importExportError: 'This file does not look like a valid '
                            + 'sqlite database.',
                    });
                    return;
                }
                writeFileSync(getDatabasePath(), req.file.buffer);
                restored.push('the database');
            } else {
                await sendMauiPage(req, res, config, {
                    importExportError: 'Unrecognized format: use a .json, a .sqlite/.db or '
                        + 'a .zip containing both.',
                });
                return;
            }
        } catch (error) {
            await sendMauiPage(req, res, config, {
                importExportError: `Import failed: ${error instanceof Error ? error.message : String(error)}`,
            });
            return;
        }

        // Same reasoning as /reset's config/database branches: the renderer's long-lived Vuex
        // store instances (see store.ts's initServices) were built from the files just
        // overwritten, so only a full process restart picks up the import.
        res.send(renderPage(
            '<section class="card"><h2>Import complete</h2>'
            + `<p class="error">Restored: ${restored.join(', ')}. The application will close `
            + 'in a moment. <strong>Relaunch it manually</strong> to take the imported '
            + 'files into account (<code>just serve</code> in development, or the usual '
            + 'executable in production).</p></section>',
            'maui',
        ));

        setTimeout(onReset, 300);
    });

    // Not role-gated beyond being logged in for a real release - installing one of those onto
    // the device the BO itself runs on is exactly what a "user"-role account (e.g. puckman) is
    // meant to be able to do, same trust level as everything else on the "General" MAUI subtab.
    // A dev build (GitHub prerelease published from develop, see getUpdateInfo()) stays
    // admin-only even though the asset itself needs no auth to download - checked server-side
    // below, not just by hiding the row in renderUpdateCard(), since the tagName/assetUrl pair
    // is posted back by the client and could otherwise be forged by a "user"-role account.
    app.post('/maui/update/install', async (req, res) => {
        const config = new Config();
        config.load();
        const tagName = typeof req.body.tagName === 'string' ? req.body.tagName : '';
        const assetUrl = typeof req.body.assetUrl === 'string' ? req.body.assetUrl : '';
        const isAdmin = req.session.boRole === 'admin';

        if (!isSelfUpdateCapable() || !assetUrl) {
            await sendMauiPage(req, res, config, {updateInfoError: 'Installation unavailable on this machine.'});
            return;
        }

        const preUpdateInfo = await getUpdateInfo();
        if (!isAdmin && preUpdateInfo.devBuilds.some(build => build.tagName === tagName)) {
            res.status(403).send('Action reserved to administrators.');
            return;
        }

        res.writeHead(200, {'Content-Type': 'text/html; charset=utf-8'});
        res.socket?.setNoDelay(true);
        res.write(renderPageHead('maui'));
        await runUpdateInstall(res, `Installing version ${tagName}…`, assetUrl);

        const updateInfo = await getUpdateInfo();
        res.write(renderMauiCard(config));
        res.write(renderUpdateCard(updateInfo, isAdmin));
        if (isAdmin) {
            res.write(renderMauiImportExportCard());
            res.write(renderMauiDangerZoneCard());
        }
        res.write(renderPageTail());
        res.end();
    });

    app.post('/screenscraper/save', (req, res) => {
        const values: ScreenScraperValues = {
            ssDevId: (req.body.ssDevId || '').trim(),
            ssDevPassword: (req.body.ssDevPassword || '').trim(),
            ssSoftName: (req.body.ssSoftName || '').trim(),
            ssUserId: (req.body.ssUserId || '').trim(),
            ssUserPassword: (req.body.ssUserPassword || '').trim(),
            bezelAspect: req.body.bezelAspect === '4:3' ? '4:3' : '16:9',
        };

        const config = new Config();
        config.load();
        config.ssDevId = values.ssDevId;
        config.ssDevPassword = values.ssDevPassword;
        config.ssSoftName = values.ssSoftName;
        config.ssUserId = values.ssUserId;
        config.ssUserPassword = values.ssUserPassword;
        config.bezelAspect = values.bezelAspect;
        config.save();

        res.send(renderScreenScraperPage(
            values, hasScreenScraperCredentials(config), undefined, 'ScreenScraper configuration saved.',
        ));
    });

    app.get('/browse', (req, res) => {
        const target: PathField = req.query.target === 'pluginsPath' ? 'pluginsPath' : 'mamePath';
        const initialValue = typeof req.query[target] === 'string' ? req.query[target] as string : '';

        let currentDir = typeof req.query.path === 'string' && req.query.path ? req.query.path : initialValue;
        if (!currentDir || !existsSync(currentDir)) {
            const config = new Config();
            config.load();
            if (target === 'mamePath') {
                currentDir = config.mamePath || os.homedir();
            } else {
                const iniPath = getMameHomePath();
                const pluginsPath = getMameIniValue(join(iniPath, 'mame.ini'), 'pluginspath');
                currentDir = pluginsPath ? resolveDirectoryPath(pluginsPath, iniPath) : os.homedir();
            }
        }
        if (!existsSync(currentDir)) {
            currentDir = os.homedir();
        }

        res.send(renderBrowsePage(target, currentDir, initialValue));
    });

    app.post('/save', (req, res) => {
        const mamePath: string = (req.body.mamePath || '').trim();
        const config = new Config();
        config.load();
        const isAdmin = req.session.boRole === 'admin';

        if (!existsSync(mamePath)) {
            res.status(422).send(renderForm(
                {mamePath}, getMameInfo(config), isAdmin,
                `The folder "${mamePath}" does not exist.`,
            ));
            return;
        }
        const mameBinaryName = findMameBinary(mamePath);
        if (!mameBinaryName) {
            res.status(422).send(renderForm(
                {mamePath}, getMameInfo(config), isAdmin,
                `No mame binary found in "${mamePath}".`,
            ));
            return;
        }

        try {
            ensureMameConfigBootstrapped(join(mamePath, mameBinaryName), getMameHomePath());
        } catch (error) {
            res.status(422).send(renderForm(
                {mamePath}, getMameInfo(config), isAdmin,
                'Failed to initialize mame ("-createconfig"): '
                    + `${error instanceof Error ? error.message : 'unexpected error'}.`,
            ));
            return;
        }

        config.mamePath = mamePath;
        config.mameBinaryName = mameBinaryName;
        config.save();

        res.send(renderPage(
            '<section class="card"><h2>Configuration saved</h2><p>'
            + 'The application restarts automatically.</p>'
            + '<p>Back to the MAME configuration in <span id="redirect-countdown">5</span> '
            + 'second(s)… <a href="/">Go now</a>.</p></section>'
            + '<script>'
            + 'var secondsLeft = 5;'
            + 'var countdownEl = document.getElementById("redirect-countdown");'
            + 'setInterval(function () {'
            + 'secondsLeft -= 1;'
            + 'countdownEl.textContent = Math.max(secondsLeft, 0);'
            + '}, 1000);'
            + 'setTimeout(function () { window.location.href = "/"; }, 5000);'
            + '</script>',
        ));

        onConfigured();
    });

    app.post('/launch', (req, res) => {
        const config = new Config();
        config.load();

        const isAdmin = req.session.boRole === 'admin';

        if (!isAdmin) {
            res.status(403).send('Action reserved to administrators.');
            return;
        }

        if (!config.mamePath || !config.mameBinaryName) {
            res.status(422).send(renderForm(
                {mamePath: config.mamePath || ''},
                getMameInfo(config), isAdmin,
                'No valid configuration saved: unable to launch mame.',
            ));
            return;
        }

        const mameBinary = join(config.mamePath, config.mameBinaryName);
        if (!existsSync(mameBinary)) {
            res.status(422).send(renderForm(
                {mamePath: config.mamePath},
                getMameInfo(config), isAdmin,
                `The binary "${mameBinary}" was not found.`,
            ));
            return;
        }

        // Same launch shape as MameService.startGame(), minus -skip_gameinfo/romName:
        // no rom selected here, so mame opens its own UI, on the dedicated home
        // directory mame-awesome-ui always pins it to.
        const iniPath = getMameHomePath();
        const mameProcess = execFile(mameBinary, ['-inipath', iniPath, '-homepath', iniPath], {
            killSignal: 'SIGQUIT',
            cwd: iniPath,
        }, error => {
            if (error) {
                console.error('[boServer] mame exited with an error:', error);
            }
        });
        mameProcess.once('error', error => {
            console.error('[boServer] failed to launch mame:', error);
        });

        res.send(renderForm(
            {mamePath: config.mamePath},
            getMameInfo(config), isAdmin,
            undefined,
            'Mame was launched, check that a window actually opened on the machine hosting mame-awesome-ui.',
        ));
    });

    app.post('/mame-options/save', (req, res) => {
        const config = new Config();
        config.load();

        const iniPath = getMameHomePath();
        const mameIniPath = join(iniPath, 'mame.ini');
        const pluginIniPath = join(iniPath, 'plugin.ini');
        const windowed = req.body.windowed === 'on';
        const pluginsPath: string = (req.body.pluginsPath || '').trim();

        let saved = setMameIniValue(mameIniPath, 'window', windowed ? '1' : '0');
        let pluginsAdded = 0;
        if (pluginsPath) {
            saved = setMameIniValue(mameIniPath, 'pluginspath', pluginsPath) && saved;
            // As soon as pluginspath points at a folder that actually has plugins in it,
            // initialize/complete plugin.ini right away instead of making the user click the
            // separate "Repair plugin.ini" button as a second step.
            const availablePlugins = getAvailablePlugins(resolveDirectoryPath(pluginsPath, iniPath));
            if (availablePlugins.length) {
                pluginsAdded = repairPluginIni(pluginIniPath, availablePlugins);
            }
        }

        res.send(renderForm(
            {mamePath: config.mamePath},
            getMameInfo(config), req.session.boRole === 'admin',
            undefined,
            undefined,
            saved
                ? 'MAME options updated in mame.ini.'
                    + (pluginsAdded ? ` ${pluginsAdded} plugin(s) initialized in plugin.ini.` : '')
                : 'mame.ini not found - configure and launch mame at least once before changing these options.',
        ));
    });

    app.post('/mame-options/repair-plugins', (req, res) => {
        const config = new Config();
        config.load();

        const iniPath = getMameHomePath();
        const mameIniPath = join(iniPath, 'mame.ini');
        const pluginIniPath = join(iniPath, 'plugin.ini');
        const pluginsPath = getMameIniValue(mameIniPath, 'pluginspath');
        const resolvedPluginsPath = pluginsPath ? resolveDirectoryPath(pluginsPath, iniPath) : null;
        const added = repairPluginIni(pluginIniPath, getAvailablePlugins(resolvedPluginsPath));

        res.send(renderForm(
            {mamePath: config.mamePath},
            getMameInfo(config), req.session.boRole === 'admin',
            undefined,
            undefined,
            added
                ? `${added} plugin(s) added to plugin.ini (mame default values).`
                : 'Nothing to repair: plugin.ini already contains all the detected plugins (or no plugin was found - check the plugins folder below).',
        ));
    });

    app.post('/input-probe', (req, res) => {
        if (req.session.boRole !== 'admin') {
            res.status(403).send('Action reserved to administrators.');
            return;
        }
        const config = new Config();
        config.load();
        const mameInfo = getMameInfo(config);
        const isAdmin = req.session.boRole === 'admin';

        const romName: string = (req.body.romName || '').trim();

        if (mameInfo.error) {
            // Shouldn't normally be reachable (renderForm() only renders the probe card once
            // mameInfo.error is unset), but the config could have changed underneath a stale
            // form submission (e.g. mamePath cleared in another tab/request).
            res.status(422).send(renderForm(
                {mamePath: config.mamePath || ''}, mameInfo, isAdmin,
            ));
            return;
        }

        const romNames = mameInfo.romPath ? listRomNames(mameInfo.romPath) : [];
        if (!romName || !romNames.includes(romName)) {
            res.status(422).send(renderForm(
                {mamePath: config.mamePath}, mameInfo, isAdmin,
                undefined, undefined, undefined, undefined, undefined,
                {selectedRom: romName, error: 'Invalid rom, or not found in the roms folder.'},
            ));
            return;
        }

        try {
            const result = runInputProbe(join(config.mamePath, config.mameBinaryName), mameInfo.iniPath, romName);
            res.send(renderForm(
                {mamePath: config.mamePath}, mameInfo, isAdmin,
                undefined, undefined, undefined, undefined, undefined,
                {selectedRom: romName, result},
            ));
        } catch (error) {
            console.error(`[boServer] Input probe failed for "${romName}":`, error);
            const message = error instanceof Error ? error.message : 'unexpected error';
            res.status(500).send(renderForm(
                {mamePath: config.mamePath}, mameInfo, isAdmin,
                undefined, undefined, undefined, undefined, undefined,
                {
                    selectedRom: romName,
                    error: `Probe of "${romName}" failed: ${message}`
                        + ' (timeout, non-zero exit code, or binary not found).',
                },
            ));
        }
    });

    app.post('/input-probe/devices', (req, res) => {
        if (req.session.boRole !== 'admin') {
            res.status(403).send('Action reserved to administrators.');
            return;
        }
        const config = new Config();
        config.load();
        const mameInfo = getMameInfo(config);
        const isAdmin = req.session.boRole === 'admin';

        const romNames = mameInfo.romPath ? listRomNames(mameInfo.romPath) : [];
        const romName = romNames[0];

        if (mameInfo.error || !romName) {
            // Same "shouldn't normally be reachable" caveat as /input-probe above - the form only
            // renders once mameInfo.error is unset and at least one rom exists.
            res.status(422).send(renderForm(
                {mamePath: config.mamePath || ''}, mameInfo, isAdmin,
            ));
            return;
        }

        try {
            const result = runDeviceProbe(join(config.mamePath, config.mameBinaryName), mameInfo.iniPath, romName);
            res.send(renderForm(
                {mamePath: config.mamePath}, mameInfo, isAdmin,
                undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined,
                {result},
            ));
        } catch (error) {
            console.error('[boServer] Device probe failed:', error);
            const message = error instanceof Error ? error.message : 'unexpected error';
            res.status(500).send(renderForm(
                {mamePath: config.mamePath}, mameInfo, isAdmin,
                undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined,
                {error: `Device probe failed: ${message} (timeout, non-zero exit code, or binary not found).`},
            ));
        }
    });

    app.post('/input-probe/mame/start', (req, res) => {
        if (req.session.boRole !== 'admin') {
            res.status(403).send('Action reserved to administrators.');
            return;
        }
        const config = new Config();
        config.load();
        const mameInfo = getMameInfo(config);
        const isAdmin = req.session.boRole === 'admin';

        const romNames = mameInfo.romPath ? listRomNames(mameInfo.romPath) : [];
        const romName = romNames[0];
        if (!mameInfo.error && romName) {
            startMameConfigSession(join(config.mamePath, config.mameBinaryName), mameInfo.iniPath, romName);
        }

        res.send(renderForm({mamePath: config.mamePath}, mameInfo, isAdmin));
    });

    app.post('/input-probe/mame/stop', (req, res) => {
        if (req.session.boRole !== 'admin') {
            res.status(403).send('Action reserved to administrators.');
            return;
        }
        const config = new Config();
        config.load();
        const mameInfo = getMameInfo(config);
        const isAdmin = req.session.boRole === 'admin';

        stopMameConfigSession();

        res.send(renderForm({mamePath: config.mamePath}, mameInfo, isAdmin));
    });

    app.post('/input-probe/remap', (req, res) => {
        if (req.session.boRole !== 'admin') {
            res.status(403).send('Action reserved to administrators.');
            return;
        }
        const config = new Config();
        config.load();
        const mameInfo = getMameInfo(config);
        const isAdmin = req.session.boRole === 'admin';

        const portType: string = (req.body.portType || '').trim();
        const action = REMAP_ACTIONS_BY_TYPE.get(portType);

        if (mameInfo.error || !action) {
            // mameInfo.error: same "shouldn't normally be reachable" caveat as /input-probe above
            // - the form only renders once mameInfo.error is unset. !action: portType isn't in
            // REMAP_ACTIONS_BY_TYPE - only reachable by posting outside the rendered form, since
            // every form's hidden portType field is one of ours.
            res.status(422).send(renderForm(
                {mamePath: config.mamePath || ''}, mameInfo, isAdmin,
            ));
            return;
        }

        if (!isMameConfigSessionAlive()) {
            res.send(renderForm(
                {mamePath: config.mamePath}, mameInfo, isAdmin,
                undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined,
                undefined,
                {portType, error: 'MAME is not running - click "Launch MAME" first.'},
            ));
            return;
        }

        try {
            const token = captureOnePress();
            const remapState: RemapState = token
                ? {portType, capturedToken: token}
                : {portType, error: 'No press detected within the allotted time (30s) - try again ' +
                    '(the MAME window must have focus).'};
            if (token) {
                const cfgPath = getDefaultCfgPath(mameInfo.iniPath);
                setDefaultCfgUiInput(cfgPath, portType, token);
                const released = releaseTokenFromInGameUiPorts(cfgPath, portType, token);
                if (released.length) {
                    remapState.releasedFrom = released;
                }
            }
            res.send(renderForm(
                {mamePath: config.mamePath}, mameInfo, isAdmin,
                undefined, // error
                undefined, // info
                undefined, // mameInfoMessage
                undefined, // importError
                undefined, // dangerZoneInfo
                undefined, // inputProbeState
                undefined, // repoPacks
                undefined, // repoError
                undefined, // repoInfo
                undefined, // deviceProbeState
                remapState,
            ));
        } catch (error) {
            console.error(`[boServer] Remap capture failed for "${portType}":`, error);
            const message = error instanceof Error ? error.message : 'unexpected error';
            res.status(500).send(renderForm(
                {mamePath: config.mamePath}, mameInfo, isAdmin,
                undefined, // error
                undefined, // info
                undefined, // mameInfoMessage
                undefined, // importError
                undefined, // dangerZoneInfo
                undefined, // inputProbeState
                undefined, // repoPacks
                undefined, // repoError
                undefined, // repoInfo
                undefined, // deviceProbeState
                {portType, error: `Capture failed: ${message}`},
            ));
        }
    });

    app.post('/reset', async (req, res) => {
        if (req.session.boRole !== 'admin') {
            res.status(403).send('Action reserved to administrators.');
            return;
        }
        const config = new Config();
        config.load();
        const mameInfo = getMameInfo(config);

        // Each danger-zone card (renderMameDangerZoneCard/renderMauiDangerZoneCard) posts its
        // own hidden "zone" field alongside only its own checkboxes - gating on it here means a
        // MAME-zone submission can only ever delete MAME's own data, and a maui-zone submission
        // only mame-awesome-ui's own, regardless of what a request might otherwise contain.
        const zone = req.body.zone === 'maui' ? 'maui' : 'mame';

        // deleteMameHome wipes mameInfo.iniPath (~/.mame) wholesale, which already contains
        // everything deleteHiscores/deleteGamesMedia/deleteFavorites would otherwise remove - so
        // those are skipped when it's checked, rather than redundantly rm'ing paths about to
        // disappear anyway (the danger-zone card's onchange also ticks+disables them when this
        // one is checked, purely to communicate that they're included).
        const deleteMameHome = zone === 'mame' && req.body.deleteMameHome === 'on';
        const deleteHiscores = zone === 'mame' && !deleteMameHome && req.body.deleteHiscores === 'on';
        const deleteGamesMedia = zone === 'mame' && !deleteMameHome && req.body.deleteGamesMedia === 'on';
        const deleteFavorites = zone === 'mame' && !deleteMameHome
            && req.body.deleteFavorites === 'on' && !!mameInfo.favoritesPath;
        const deleteConfig = zone === 'maui' && req.body.deleteConfig === 'on';
        const deleteDatabase = zone === 'maui' && req.body.deleteDatabase === 'on';

        const deleted: string[] = [];

        if (deleteMameHome) {
            try {
                rmSync(mameInfo.iniPath, {recursive: true, force: true});
                deleted.push(
                    `the whole ${mameInfo.iniPath} directory and its content (configuration, roms, media, `
                    + 'hiscores, cfg, nvram, snapshots...)',
                );
            } catch (error) {
                console.error(`[boServer] Failed to remove mame home directory "${mameInfo.iniPath}":`, error);
            }
        }

        if (deleteHiscores) {
            try {
                rmSync(getHiscorePath(mameInfo.iniPath), {recursive: true, force: true});
                deleted.push('the hiscores');
            } catch (error) {
                console.error('[boServer] Failed to remove hiscore directory:', error);
            }
        }

        if (deleteGamesMedia) {
            [mameInfo.romPath, mameInfo.marqueePath, mameInfo.flyerPath, mameInfo.logoPath].forEach((gamesPath) => {
                if (!gamesPath) {
                    return;
                }
                try {
                    rmSync(gamesPath, {recursive: true, force: true});
                } catch (error) {
                    console.error(`[boServer] Failed to remove games directory "${gamesPath}":`, error);
                }
            });
            deleted.push('the games roms and media (roms, marquees, flyers, logos)');
        }

        if (deleteFavorites) {
            try {
                // Cast: gated above on !!mameInfo.favoritesPath.
                rmSync(mameInfo.favoritesPath as string, {force: true});
                deleted.push('the favorites file (favorites.ini)');
            } catch (error) {
                console.error('[boServer] Failed to remove favorites.ini:', error);
            }
        }

        if (deleteConfig) {
            config.delete();
            deleted.push('the mame-awesome-ui configuration');
        }

        if (deleteDatabase) {
            try {
                rmSync(getDatabasePath(), {force: true});
                deleted.push('the database');
            } catch (error) {
                console.error('[boServer] Failed to remove database file:', error);
            }
        }

        if (!deleted.length) {
            if (zone === 'mame') {
                res.send(renderForm(
                    {mamePath: config.mamePath || ''}, mameInfo, true,
                    undefined, undefined, undefined, undefined,
                    'No box ticked: nothing to delete.',
                ));
            } else {
                await sendMauiPage(req, res, config, {dangerZoneInfo: 'No box ticked: nothing to delete.'});
            }
            return;
        }

        // Config/database deletion invalidates the renderer's long-lived Vuex store instances
        // (see store.ts's initServices), same reason the previous all-in-one reset always
        // closed the app - only a full process restart clears that in-memory state. Hiscores
        // and media are just files/directories MameService/HiscoreService re-resolve on every
        // access, so those two don't need it. deleteMameHome does need it too: it takes
        // mame.ini/ui.ini down with it, and MameService's constructor only ever parses those
        // once, at app startup - a restart is what makes it re-bootstrap them from scratch.
        const needsRestart = deleteConfig || deleteDatabase || deleteMameHome;
        const backHref = zone === 'mame' ? '/' : '/maui';
        const deletedInfo = `Deleted: ${deleted.join(', ')}.`;

        // No restart needed (hiscores/games media/favorites) - land back on the zone's own page
        // with an inline message, same as every other action in the BO (renderForm/
        // renderMauiPage's own info params), instead of a dead-end page whose only affordance is
        // a "Retour" link. The dead-end + auto-reconnect page below is reserved for the case
        // where the process is actually about to exit and there's nothing else to show yet.
        if (!needsRestart) {
            if (zone === 'mame') {
                res.send(renderForm(
                    {mamePath: config.mamePath || ''}, mameInfo, true,
                    undefined, undefined, undefined, undefined, deletedInfo,
                ));
            } else {
                await sendMauiPage(req, res, config, {dangerZoneInfo: deletedInfo});
            }
            return;
        }

        res.send(renderPage(
            '<section class="card"><h2>Deletion complete</h2>'
            + `<p class="error">${deletedInfo}</p>`
            + '<p>The application will close in a moment. '
                + '<strong>Relaunch it manually</strong> to complete the operation '
                + '(<code>just serve</code> in development, or the usual executable in '
                + 'production) - reloading this page or the application is not enough: the '
                + 'renderer keeps the services built on the old configuration in memory '
                + 'until the process has fully restarted.</p>'
                + '<p id="restart-wait-message" class="info">Waiting for the restart… '
                + 'this page will automatically take you back to the home page as soon as the '
                + 'server is available again.</p>'
                + `<script>${
                    // Polls the BO server itself (the same process this reset just told to
                    // exit - see onReset below) until it answers again, then redirects -
                    // rather than relying on the user to remember to come back once they've
                    // relaunched it manually. Only trusts a successful response *after* one
                    // has already failed: right after this page loads the old process may
                    // still be up for a moment (see the 300ms exit delay below), and an
                    // immediate success there would just bounce straight back with nothing
                    // actually restarted yet.
                    'var backHref = ' + JSON.stringify(backHref) + ';'
                    + 'var sawDown = false;'
                    + 'var poll = function () {'
                    + 'fetch(backHref, {cache: "no-store", method: "HEAD"}).then(function () {'
                    + 'if (sawDown) { window.location.href = backHref; } else { setTimeout(poll, 1000); }'
                    + '}).catch(function () { sawDown = true; setTimeout(poll, 1000); });'
                    + '};'
                    + 'setTimeout(poll, 1000);'
                }</script>`
            + '</section>',
            zone,
        ));

        // Only closes the app (see onReset in background.ts) - it does NOT relaunch it. Delayed
        // slightly so this response finishes flushing to the browser before the process exits.
        setTimeout(onReset, 300);
    });

    return app.listen(port, () => {
        console.log(`BO server listening on http://localhost:${port}`);
    });
}
