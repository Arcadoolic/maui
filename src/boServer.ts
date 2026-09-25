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
import {ChildProcess, execFileSync, spawn} from 'child_process';
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
import {parseListFull} from '@/class/MameListFull';
import {
    compareGameFields,
    gameFieldId,
    inputIconKey,
    parseGameFields,
    portTypePlayer,
    readGameCfgInputSeqs,
    removeGameCfgInputSeq,
    setGameCfgInputSeq,
    type GameField,
} from '@/class/MameCfg';
import {addFavorite} from '@/class/MameIniParser';
import {
    FavoritesCacheEntry, FavoritesCache, getFavoritesCachePath, readFavoritesCache,
    writeFavoritesCache, readRemovedFavorites, writeRemovedFavorites, removeFavoriteFromDisk,
} from '@/class/FavoritesStore';
import {
    computeBiosSizes, computePackOwnership, groupSelectedGames, isPackFullyOwned, listPackGames, PackGameDetail,
    PackOwnership,
} from '@/class/PackOwnership';
import {fetchRemoteZipEntrySizes} from '@/class/ZipCentralDirectory';
import {decodeXmlEntities} from '@/class/XmlEntities';
import {canRestartKiosk, restartKiosk} from '@/class/KioskRestart';
import {hasHiscoreExtraction} from '@/class/HiscoreSupport';
import {getCategoryDisplayName, getCategoryIconKey} from '@/class/CarouselCategories';
import type {StartingPackManifest} from '@/types/StartingPackManifest';
import {ensureDefaultAvatar} from '@/class/DefaultAvatar';
import {
    findDeletedUser, listDeletedUsers, restoreDeletedUser, purgeDeletedUser, DeletedUserRow,
} from '@/class/UserReservation';
import {findAvatarFile, avatarCacheBust} from '@/class/AvatarFiles';
import {Vote, VOTE_DOWN, VOTE_NEUTRAL, VOTE_UP, parseVote} from '@/class/GameVote';
import {runMigrations} from '@/class/Migrations';
import {sortByPublishedDesc, formatPublishedAt} from '@/class/ReleaseList';
import {parseGamepadIds} from '@/class/GamepadId';
import {readCtrlrMapDevices, setCtrlrMapDevice} from '@/class/MameCtrlr';
import {
    MAUI_KEYS, MAUI_CONTROL_CONTEXTS, STANDARD_BUTTON_NAMES, keyLabel, describeGamepadInputs,
} from '@/class/MauiControls';
import {escapeHtml} from '@/class/EscapeHtml';
import {
    describeOnlineStatus, getOnlineView, resetOnlineSettings, saveConfigurationString, setOnlineEnabled, testConnection,
} from '@/class/OnlineSetup';
import {OnlineSession} from '@/class/OnlineSession';
import {readMameVersion} from '@/class/MameVersion';
import {renderOnlineCard} from '@/class/OnlineBoCard';
import {isSameOriginRequest} from '@/class/SameOrigin';
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
import {CONF_PACK_FILENAME, getMissingConfPackFiles, isGamePack} from '@/class/ConfPack';
import {generateDataKey, unwrapDataKey, wrapDataKey} from '@/class/SecretBox';
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
        // "Advanced configuration" mode (see POST /advanced): shows the sections an owner rarely
        // needs (ScreenScraper, Repository, Danger...). Off at every sign-in.
        boAdvanced?: boolean;
        // Data key of the config file's encrypted credentials (hex, see SecretBox.ts), unwrapped
        // at sign-in - the session store is in memory only, so it never reaches the disk.
        secretsKey?: string;
        // Signed in with the default password: every page but /account (and sign-out) redirects
        // there until it is changed, and the credentials stay locked meanwhile.
        mustChangePassword?: boolean;
    }
}

type Tab = 'mame' | 'screenscraper' | 'favorites' | 'users' | 'maui' | 'account';
// Who a page is rendered for: 'basic' leaves the Advanced configuration tabs/sections out (see
// POST /advanced), and null (signed out - the login page) gets no nav at all.
type Viewer = 'advanced' | 'basic' | null;
type PathField = 'mamePath' | 'pluginsPath';

interface ScreenScraperValues {
    ssDevId: string;
    ssDevPassword: string;
    ssSoftName: string;
    ssUserId: string;
    ssUserPassword: string;
    bezelAspect: '4:3' | '16:9';
}

// One entry per pack on repo.maui.afronob.com's index.json (generated on the repository side) -
// only the fields the picker actually displays are typed here, not the full manifest.
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
 * Creates the database if it doesn't exist yet and brings it up to date - what the renderer's
 * Database.install()/update() (Init.vue) does, but run by the main process as soon as the app
 * starts, before any window opens (see background.ts): on a first launch the BO login page is
 * reachable right away, and its bo_user table (created and seeded by a migration) must already
 * be there - Init.vue used to be the only one creating it, racing against the first sign-in.
 * Same base tables as Database.install()'s sync() (bo_user excluded, see its models comment),
 * created only when missing: also repairs a file left empty by a connection opened before any
 * table existed. Never rejects: a failure is logged and Init.vue then tries again itself.
 */
async function bootstrapDatabase(sequelize: Sequelize): Promise<void> {
    try {
        const tables = await sequelize.getQueryInterface().showAllTables();
        if (!tables.includes('game')) {
            // One by one, referenced tables first (game -> category, hiscore -> game/user).
            for (const model of [Category, Game, User, Hiscore]) {
                await model.sync();
            }
        }
        await runMigrations(sequelize);
    } catch (error) {
        console.error('[boServer] Database bootstrap failed:', error);
    }
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
 * Same sqlite connection Database.class.ts sets up (bootstrapped by bootstrapDatabase() below
 * rather than its install()/update()) - built directly here rather than importing
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
    // Optional progettoSNAPS catver.ini: read instead of genre.ini when present (see
    // GameService.getGameCategories()).
    catverIniPath: string | null;
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
    // [ \t], not \s: -createconfig writes empty-valued keys (e.g. "ctrlr") as the key plus
    // trailing spaces, and \s+ would run on into the next line and overwrite its key instead.
    const lineRegex = new RegExp(`^(${key}[ \\t]+)\\S*|^${key}$`, 'm');
    const updated = lineRegex.test(content)
        ? content.replace(lineRegex, (_line, keyAndSpacing?: string) => `${keyAndSpacing ?? key.padEnd(26)}${value}`)
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
    catverIniPath: string | null;
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
        marqueePath, flyerPath, logoPath, favoritesPath, genreIniPath, catverIniPath, nplayersIniPath,
    } = getMameLocations(iniPath);
    const windowed = getMameIniValue(mameIniPath, 'window') === '1';
    const pluginsPath = getMameIniValue(mameIniPath, 'pluginspath');
    const resolvedPluginsPath = pluginsPath ? resolveDirectoryPath(pluginsPath, iniPath) : null;
    const missingPlugins = getMissingPlugins(pluginIniPath, getAvailablePlugins(resolvedPluginsPath));

    if (!config.mamePath || !config.mameBinaryName) {
        return {
            iniPath, mameIniPath, uiIniPath, pluginIniPath, romPath: null, marqueePath, flyerPath, logoPath,
            favoritesPath, genreIniPath, catverIniPath, nplayersIniPath, windowed, pluginsPath, missingPlugins, showConfig: null,
            error: 'Configure the mame binary (Config tab) to see the roms path.',
        };
    }

    const mameBinary = join(config.mamePath, config.mameBinaryName);
    if (!existsSync(mameBinary)) {
        return {
            iniPath, mameIniPath, uiIniPath, pluginIniPath, romPath: null, marqueePath, flyerPath, logoPath,
            favoritesPath, genreIniPath, catverIniPath, nplayersIniPath, windowed, pluginsPath, missingPlugins, showConfig: null,
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
            favoritesPath, genreIniPath, catverIniPath, nplayersIniPath, windowed, pluginsPath, missingPlugins, showConfig: parsed,
        };
    } catch {
        return {
            iniPath, mameIniPath, uiIniPath, pluginIniPath, romPath: null, marqueePath, flyerPath, logoPath,
            favoritesPath, genreIniPath, catverIniPath, nplayersIniPath, windowed, pluginsPath, missingPlugins, showConfig: null,
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
 * synchronous, and the rom dropdowns (see renderRomPicker()) only need romName, not Game's
 * fullname.
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

let romLabelsCache: {key: string; labels: Map<string, string>} | undefined;

/**
 * Game name (MAME's description, e.g. "Pac-Man (Midway)") by rom name, for the rom selects: one
 * `mame -listfull <rom>...` for the whole folder (~0.1s for a few hundred roms), remembered until
 * the rom list or binary changes since renderForm() runs on every request. A rom MAME doesn't
 * know (or a failing binary) is just absent from the map - callers fall back to the rom name.
 */
function getRomLabels(mameBinary: string, iniPath: string, romNames: string[]): Map<string, string> {
    const key = `${mameBinary}\n${romNames.join(',')}`;
    if (romLabelsCache?.key === key) {
        return romLabelsCache.labels;
    }
    let stdout = '';
    if (romNames.length) {
        try {
            stdout = execFileSync(
                mameBinary,
                ['-listfull', ...romNames, '-inipath', iniPath, '-homepath', iniPath],
                {encoding: 'utf8', cwd: iniPath, stdio: ['ignore', 'pipe', 'pipe'], timeout: 15000, maxBuffer: 4 * 1024 * 1024},
            );
        } catch (error) {
            // MAME exits non-zero as soon as one name matches nothing (a stray zip) but still
            // lists the others - keep whatever it printed.
            const partial = (error as {stdout?: string | Buffer}).stdout;
            stdout = partial ? partial.toString() : '';
        }
    }
    const labels = parseListFull(stdout);
    romLabelsCache = {key, labels};
    return labels;
}

/**
 * Roms whose cfg/<rom>.cfg holds a key binding of its own (a standard <newseq>, see
 * MameCfg.ts) - what the rom pickers flag. Not "has a cfg file" as such: MAME writes one for
 * nearly every game ever launched (mixer settings alone), so that would mark almost every game.
 */
function listRomsWithInputCfg(iniPath: string, romNames: string[]): Set<string> {
    const withCfg = new Set<string>();
    for (const romName of romNames) {
        const cfgPath = getGameCfgPath(iniPath, romName);
        try {
            if (existsSync(cfgPath) && readGameCfgInputSeqs(readFileSync(cfgPath, 'utf8')).size) {
                withCfg.add(romName);
            }
        } catch {
            // Unreadable cfg: just not flagged.
        }
    }
    return withCfg;
}

const INPUT_CFG_ICON = '\u{1F3AE}';
const INPUT_CFG_LEGEND = `${INPUT_CFG_ICON} = this game already has its own key configuration (<code>cfg/&lt;rom&gt;.cfg</code>).`;

/**
 * Searchable rom picker: a text field filtering a plain <select> (works without the script, just
 * unfiltered) of game names sorted alphabetically, each flagged with an icon when it has its own
 * input cfg. The script is self-contained (finds its picker through document.currentScript) since
 * several pickers can share the page. Typing turns the select into a short list box so the
 * matches are visible without opening it; every term must appear, accents and case ignored, in
 * the game name or its rom name.
 */
function renderRomPicker(
    selectId: string, romNames: string[], romLabels: Map<string, string>, withCfg: Set<string>, selectedRom?: string,
): string {
    const options = romNames
        .map(romName => ({romName, label: romLabels.get(romName) ?? romName}))
        .sort((a, b) => a.label.localeCompare(b.label))
        .map(({romName, label}) => `
            <option value="${escapeHtml(romName)}" data-search="${escapeHtml(`${label} ${romName}`)}"
                ${selectedRom === romName ? 'selected' : ''}>${withCfg.has(romName) ? `${INPUT_CFG_ICON} ` : ''}${escapeHtml(label)}</option>
        `).join('');

    return `
        <div class="rom-picker">
            <label for="${escapeHtml(selectId)}">Game</label>
            <input type="search" class="rom-search" placeholder="Search a game…" autocomplete="off"
                aria-label="Search a game">
            <select id="${escapeHtml(selectId)}" name="romName">${options}</select>
            <p class="info table-search-count rom-search-count" hidden></p>
            <p class="info">${INPUT_CFG_LEGEND}</p>
            <script>(function () {
                var root = document.currentScript.parentNode;
                var search = root.querySelector('.rom-search');
                var select = root.querySelector('select');
                var count = root.querySelector('.rom-search-count');
                // Last game really picked: kept across searches with no result, which empty the select.
                var chosen = select.value;
                var all = Array.prototype.map.call(select.options, function (option) {
                    return {option: option, haystack: fold(option.dataset.search || '')};
                });
                function fold(text) {
                    return text.normalize('NFD').replace(/[\\u0300-\\u036f]/g, '').toLowerCase();
                }
                function applySearch() {
                    var terms = fold(search.value).split(/\\s+/).filter(Boolean);
                    var matches = all.filter(function (entry) {
                        return terms.every(function (term) { return entry.haystack.indexOf(term) >= 0; });
                    });
                    while (select.firstChild) { select.removeChild(select.firstChild); }
                    matches.forEach(function (entry) { select.appendChild(entry.option); });
                    if (matches.some(function (entry) { return entry.option.value === chosen; })) {
                        select.value = chosen;
                    } else if (matches.length) {
                        select.selectedIndex = 0;
                        chosen = select.value;
                    }
                    select.size = terms.length && matches.length > 1 ? Math.min(matches.length, 8) : 1;
                    count.hidden = terms.length === 0;
                    count.textContent = matches.length
                        ? matches.length + ' game(s) found out of ' + all.length + '.'
                        : 'No game matches this search.';
                }
                select.addEventListener('change', function () { chosen = select.value; });
                search.addEventListener('input', applySearch);
                search.addEventListener('keydown', function (event) {
                    if (event.key === 'Enter') { event.preventDefault(); }
                });
            })();</script>
        </div>
    `;
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
    // Launch count per rom (see loadGameStats()); a rom absent from it, or no map at all (database
    // not migrated yet), shows no count.
    stats?: Map<string, GameStats>;
    // One-shot flash messages after a favorite was removed (POST /favorites/delete).
    notice?: string;
    warning?: string;
}

/**
 * What the database knows about a game (Game.play_count/vote and its category), for the
 * favorites and removed favorites lists. Soft-deleted games included: a game taken out of the
 * favorites (thumbs down, or removed from the BO) keeps its history.
 */
interface GameStats {
    romName: string;
    fullname: string;
    playCount: number;
    vote: Vote;
    // The game's carousel category (TTL twin merged, as displayed on the cabinet), null when
    // genre.ini doesn't know it.
    category: GameCategory | null;
}

interface GameCategory {
    name: string;
    iconKey: string;
}

/**
 * Every game's GameStats by rom name, or null when the database can't be read (no file yet, or
 * not migrated yet - same race as /login): callers then just leave
 * these columns out instead of breaking the whole Games tab.
 */
async function loadGameStats(): Promise<Map<string, GameStats> | null> {
    try {
        const games = await Game.findAll({
            attributes: ['romName', 'fullname', 'play_count', 'vote', 'id_category'],
            paranoid: false,
        });
        const categories = new Map((await Category.findAll()).map(category => [category.id_category, {
            name: getCategoryDisplayName(category.name),
            iconKey: getCategoryIconKey(category.name),
        }]));
        return new Map(games.map(game => [game.romName, {
            romName: game.romName,
            fullname: game.fullname || game.romName,
            playCount: game.play_count || 0,
            vote: parseVote(game.vote) ?? VOTE_NEUTRAL,
            category: categories.get(game.id_category) ?? null,
        }]));
    } catch {
        return null;
    }
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

/**
 * Re-resolves every favorite's name/BIOS (a blocking `mame -lx` per rom, see resolveFavoriteRow())
 * and rewrites the favorites cache, streaming one progress line per favorite to `res` as they
 * resolve. Shared by "Update favorites" (POST /favorites/refresh) and both starting pack imports
 * (see streamFavoritesRefreshAfterImport()). The caller has already sent the response head;
 * this writes the open "Updating favorites" card and closes it again.
 */
function streamFavoritesRefresh(
    res: Response, context: FavoritesContext,
): {rows: FavoriteRow[]; cache: FavoritesCache} {
    // Stream the page as favorites are resolved instead of blocking on the whole list: each
    // one is a blocking `mame -lx` process spawn, so with enough favorites the unstreamed
    // version could take a long time to send anything at all - same fix already applied to
    // /favorites/download-media.
    res.write(`
        <section class="card">
            <h2>Updating favorites (${context.romNames.length})…</h2>
            ${PROGRESS_LOG_OPEN}
    `);

    const result = resolveFavorites(context, row => {
        res.write(`<li>${escapeHtml(row.romName)} : ${escapeHtml(row.fullname)}</li>`);
    });
    res.write('</ul></section>');
    return result;
}

/**
 * After a starting pack import (ZIP upload or repository), which just rewrote favorites.ini:
 * resolves the new games' names/BIOS now instead of leaving the favorites tab on "not resolved
 * yet" until "Update favorites" is clicked.
 */
function streamFavoritesRefreshAfterImport(res: Response, config: Config): void {
    const context = getFavoritesContext(config);
    if ('error' in context) {
        res.write(`<section class="card"><h2>Updating favorites</h2>
            <p class="info">Favorites not updated: ${escapeHtml(context.error)}</p></section>`);
    } else {
        streamFavoritesRefresh(res, context);
    }
}

/**
 * Resolves every favorite (see resolveFavoriteRow()) and rewrites the favorites cache with them,
 * calling `onRow` after each one so the caller can report progress as it goes.
 */
function resolveFavorites(
    context: FavoritesContext, onRow: (row: FavoriteRow, index: number) => void,
): {rows: FavoriteRow[]; cache: FavoritesCache} {
    const cacheEntries: { [romName: string]: FavoritesCacheEntry } = {};
    const rows: FavoriteRow[] = context.romNames.map((romName, index) => {
        const row = resolveFavoriteRow(context, romName);
        cacheEntries[romName] = {fullname: row.fullname, biosName: row.biosName, deviceRoms: row.deviceRoms};
        onRow(row, index);
        return row;
    });
    return {rows, cache: writeFavoritesCache(cacheEntries)};
}

// The BO account's seeded password (see migrations/20260917061122-create-bo-user.js), public by
// definition: never accepted as a new password, and forced to be changed at sign-in.
const DEFAULT_BO_PASSWORD = 'puckman';
// The wrapped data key (SecretBox.ts) can be brute-forced offline from a copy of the database,
// only the password's length and scrypt's cost stand in the way.
const MIN_BO_PASSWORD_LENGTH = 8;

function getSecretsKey(req: Request): Buffer | null {
    return req.session.secretsKey ? Buffer.from(req.session.secretsKey, 'hex') : null;
}

/**
 * Unlocks the config file's credentials for this session: unwraps boUser's data key with
 * `password` - or creates one (first sign-in since the encryption, or a key wrapped with another
 * password, e.g. a database imported from another cabinet: what it encrypted is then lost, to
 * re-enter) - then encrypts whatever password the config file still holds in the clear.
 */
async function unlockSecrets(req: Request, boUser: BoUser, password: string): Promise<void> {
    let dataKey = boUser.secretsKey ? unwrapDataKey(password, boUser.secretsKey) : null;
    if (!dataKey) {
        dataKey = generateDataKey();
        boUser.secretsKey = wrapDataKey(password, dataKey);
        await boUser.save();
    }
    req.session.secretsKey = dataKey.toString('hex');

    const config = new Config(dataKey);
    if (config.load() && config.hasPlaintextSecrets()) {
        config.save();
    }
}

/**
 * `value` attribute of a password field: never the stored password itself (it would sit in the
 * page source), only a hint that one is saved - an empty submission keeps it.
 */
function renderSavedPasswordAttributes(saved: string): string {
    return saved ? 'value="" placeholder="Saved - leave empty to keep it"' : 'value=""';
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

/**
 * Spawns `python3 scripts/import-starting-pack.py ...scriptArgs -y`, streaming its stdout/stderr
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
/**
 * Downloads and imports the repository's configuration pack (a plain `folders/` ZIP, so the
 * whole file, no --only) through runImportScript(), into an already-headed streamed response.
 * Same result: false when the script could not be launched (response already closed).
 */
function runConfPackImport(res: Response, config: Config): Promise<boolean> {
    return runImportScript(
        res,
        `Configuration pack import in progress… (${escapeHtml(CONF_PACK_FILENAME)})`,
        ['--url', `${config.repoUrl}/${CONF_PACK_FILENAME}`],
        {...process.env, MAUI_REPO_USER: config.repoUser, MAUI_REPO_PASSWORD: config.repoPassword},
    );
}

function runImportScript(
    res: Response, title: string, scriptArgs: string[], env: NodeJS.ProcessEnv,
    overall?: {index: number; total: number}, tabbed = false,
): Promise<boolean> {
    const scriptPath = join(getScriptsPath(), 'import-starting-pack.py');
    const barId = `import-progress-${++importProgressCounter}`;
    // A pack downloaded whole (--url alone) spends its first half downloading; a local file, or a
    // pack read partially (--url with --only), has no such phase.
    const hasDownload = scriptArgs.includes('--url') && !scriptArgs.includes('--only');
    // Tabbed: one panel of the tab card opened by renderImportTabsOpen() instead of a card of its
    // own; `overall.index` is its tab. Panels start hidden, mauiImportTabs.start() shows it.
    const tab = tabbed && overall ? overall.index : null;
    if (tab !== null) {
        res.write(`<div class="import-panel" data-import-panel="${tab}" hidden><h3>${title}</h3>`
            + `${renderImportProgressBar(barId, hasDownload, overall)}${PROGRESS_LOG_OPEN}`
            + `<script>mauiImportTabs.start(${tab})</script>`);
    } else {
        res.write(`<section class="card"><h2>${title}</h2>${renderImportProgressBar(barId, hasDownload, overall)}`
            + PROGRESS_LOG_OPEN);
    }
    const closeBlock = tab !== null ? '</div>' : '</section>';

    return new Promise(resolve => {
        // -y always: nobody can answer the script's confirmation prompt from here. stdin ignored
        // too, so a prompt that slips through anyway ends on EOF instead of waiting forever on
        // an open pipe.
        const child = spawn('python3', [scriptPath, ...scriptArgs, '-y'], {
            env: {...env, MAUI_PROGRESS: '1'},
            stdio: ['ignore', 'pipe', 'pipe'],
        });

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
            res.write(`</ul><p class="error">${escapeHtml(`Launch failed: ${error.message}`)}</p>${closeBlock}`);
            res.write(renderPageTail());
            res.end();
            resolve(false);
        });

        child.on('close', (code) => {
            stdoutSplitter.flush();
            stderrSplitter.flush();
            updateBar(`finish(${JSON.stringify(barId)},${code === 0})`);
            res.write(`</ul>${closeBlock}`);
            if (tab !== null) {
                res.write(`<script>mauiImportTabs.finish(${tab},${code === 0})</script>`);
            }
            resolve(true);
        });
    });
}

let importProgressCounter = 0;

/**
 * Opens the card that holds a multi-pack import: one tab per pack (all known up front, so the bar
 * is complete from the start - a pack's tab stays disabled until its import starts) and the
 * panels runImportScript() then streams into it (`tabbed`). The page follows the pack being
 * imported until the user picks a tab by hand. The caller closes it with '</div></section>'.
 */
function renderImportTabsOpen(packFilenames: string[]): string {
    // The tab only carries its number (the total is in the "Pack N of M" bar above); the pack's
    // name is in data-name, shown in that bar (mauiImportProgress) and as the tab's tooltip.
    const packName = (filename: string): string => escapeHtml(filename.replace(/\.zip$/i, ''));
    const tabs = packFilenames.map((filename, index) =>
        `<button type="button" class="import-tab" data-import-tab="${index}" data-name="${packName(filename)}"`
        + ` title="${packName(filename)}" disabled>${index + 1}</button>`).join('');
    return `
        <section class="card">
            <h2>Import from the repository</h2>
            <div class="progress-label"><span data-overall-label>Pack 1 of ${packFilenames.length} — ${packName(packFilenames[0])}</span></div>
            <div class="progress-track progress-track-thin"><div class="progress-fill" data-overall></div></div>
            <div class="import-tabs" role="tablist">${tabs}</div>
            <div class="import-panels">
        <script>
        window.mauiImportTabs = (function () {
            var picked = false;
            function tab(i) { return document.querySelector('[data-import-tab="' + i + '"]'); }
            function select(i) {
                Array.prototype.forEach.call(document.querySelectorAll('[data-import-tab]'), function (t) {
                    t.classList.toggle('active', t.dataset.importTab === String(i));
                });
                Array.prototype.forEach.call(document.querySelectorAll('[data-import-panel]'), function (panel) {
                    panel.hidden = panel.dataset.importPanel !== String(i);
                    // A hidden log can't scroll: put the newest lines back in view once shown.
                    Array.prototype.forEach.call(panel.querySelectorAll('.progress-log'), function (log) {
                        log.scrollTop = log.scrollHeight;
                    });
                });
            }
            document.addEventListener('click', function (event) {
                var target = event.target.closest ? event.target.closest('[data-import-tab]') : null;
                if (!target || target.disabled) { return; }
                picked = true;
                select(target.dataset.importTab);
            });
            return {
                start: function (i) {
                    tab(i).disabled = false;
                    tab(i).classList.add('running');
                    if (!picked) { select(i); }
                },
                finish: function (i, ok) {
                    tab(i).classList.remove('running');
                    tab(i).classList.add(ok ? 'done' : 'failed');
                }
            };
        })();
        </script>
    `;
}

/**
 * Progress bar(s) for one import run, driven by the `<script>mauiImportProgress.update(...)`
 * lines runImportScript() streams as the script reports its `@@PROGRESS` lines. Bar 1 is the
 * current pack (download, then games imported); the thinner "Pack N of M" bar of the whole batch
 * lives above the tabs (see renderImportTabsOpen()) and is the page's single [data-overall] element,
 * which this helper drives. The helper is (re)defined with each run: it is
 * idempotent, and a streamed page has no other single place to put it.
 */
function renderImportProgressBar(id: string, hasDownload: boolean, overall?: {index: number; total: number}): string {
    return `
        <div class="import-progress" id="${id}" data-download="${hasDownload ? '1' : '0'}"
            data-index="${overall ? overall.index : 0}" data-total="${overall ? overall.total : 1}">
            <div class="progress-label"><span data-label>Starting…</span><span data-percent></span></div>
            <div class="progress-track"><div class="progress-fill progress-indeterminate" data-fill></div></div>
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
                var overall = document.querySelector('[data-overall]');
                if (overall && overallFraction !== null) { overall.style.width = (overallFraction * 100).toFixed(1) + '%'; }
                var overallLabel = document.querySelector('[data-overall-label]');
                if (overallLabel) {
                    var packTab = document.querySelector('[data-import-tab="' + root.dataset.index + '"]');
                    overallLabel.textContent = 'Pack ' + (Number(root.dataset.index) + 1) + ' of ' + root.dataset.total
                        + (packTab ? ' \u2014 ' + packTab.dataset.name : '');
                }
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
                    var overall = document.querySelector('[data-overall]');
                    var index = Number(root.dataset.index), count = Number(root.dataset.total);
                    if (overall) { overall.style.width = ((index + 1) / count * 100).toFixed(1) + '%'; }
                }
            };
        })();
        </script>
    `;
}

function renderPage(body: string, active: Tab, viewer: Viewer, hasSubtabs: boolean = false): string {
    return renderPageHead(active, viewer, hasSubtabs) + body + renderPageTail();
}

function getViewer(req: Request): Viewer {
    return req.session.boAdvanced ? 'advanced' : 'basic';
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
    active: Tab, sections: Subsection[], viewer: Viewer, defaultSectionId?: string,
    // Markup shown at the right end of the subtabs row, whichever subtab is open (e.g. the MAME
    // tab's "Launch mame" button).
    navAction = '',
): string {
    if (sections.length <= 1) {
        return renderPage(sections.map(section => section.html).join(''), active, viewer);
    }
    // role="tablist"/"tab"/"tabpanel": unlike the primary nav (real page links), this switches
    // panels client-side within one page - the actual ARIA tabs pattern applies here.
    // aria-selected/tabindex are set to their real values by the tail script's activate(), once
    // it has picked which section to open - every link starts unselected/unreachable-by-Tab here
    // so a screen reader or keyboard user never sees two "tabs" claim to be selected at once
    // before that script runs.
    const nav = `
        <nav class="subtabs" role="tablist" data-default-subtab="${escapeHtml(defaultSectionId || '')}">
            ${sections.map(section => `
                <a href="#${escapeHtml(section.id)}" class="subtab-link" data-subtab="${escapeHtml(section.id)}"
                    role="tab" aria-selected="false" aria-controls="subtab-panel-${escapeHtml(section.id)}"
                    id="subtab-tab-${escapeHtml(section.id)}" tabindex="-1">
                    ${escapeHtml(section.label)}
                </a>
            `).join('')}
        </nav>
    `;
    const bar = navAction ? `<div class="subtabs-bar">${nav}<div class="subtabs-action">${navAction}</div></div>` : nav;
    const panels = sections.map(section => `
        <div class="subtab-panel" data-subtab-panel="${escapeHtml(section.id)}" role="tabpanel"
            id="subtab-panel-${escapeHtml(section.id)}" aria-labelledby="subtab-tab-${escapeHtml(section.id)}">${section.html}</div>
    `).join('');
    return renderPage(bar + panels, active, viewer, true);
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

/**
 * One primary nav link, with `aria-current="page"` alongside the `.active` class it always had -
 * these are real page-loaded links (not a JS tab widget), so a screen reader should hear "current
 * page" the same way a sighted user sees the underline, instead of nothing at all.
 */
function renderNavTabLink(href: string, label: string, isActive: boolean): string {
    return `<a href="${href}" class="${isActive ? 'active' : ''}"${isActive ? ' aria-current="page"' : ''}>${label}</a>`;
}

function renderPageHead(active: Tab, viewer: Viewer, hasSubtabs: boolean = false): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <title>mame-awesome-ui - Configuration</title>
    <style>
        /* Design tokens (Phase 0 of docs/BO-UX-REVAMP.md): every color/spacing/radius below is
           defined once here and referenced by var() everywhere else in this block, instead of
           the hex literals copy-pasted per render*() function that used to drift apart. */
        :root {
            --bg: #000000;
            /* Cards used to sit on rgba(0,0,0,0.55): fine over the darker parts of the tiled
               background photo, but text contrast could drop under WCAG AA over its brighter
               areas. Raised opacity is the actual accessibility fix; the two-tier surfaces let a
               page still show a little of the background through most cards while the login card
               (the very first thing an unauthenticated/non-technical visitor sees, nothing else
               on screen to anchor it) gets the more opaque one. */
            --surface: rgba(0, 0, 0, 0.82);
            --surface-strong: rgba(0, 0, 0, 0.9);
            --surface-inset: #111111;
            --border: #333333;
            --border-subtle: #222222;
            --text: #ffffff;
            --text-muted: #aaaaaa;
            /* Inactive menu entries (tabs, subtabs, player tabs): lighter than --text-muted, which
               read poorly as grey-on-grey over the translucent capsules. */
            --text-nav: #e0e0e0;
            --accent: #8ab4f8;
            --success: #6bff8a;
            --warn: #ffd166;
            --danger: #ff6b6b;
            --danger-strong: #c0392b;
            --radius-sm: 4px;
            --radius-md: 6px;
            --radius-lg: 8px;
            --space-1: 4px;
            --space-2: 8px;
            --space-3: 16px;
            --space-4: 24px;
            --focus-ring: 0 0 0 2px var(--bg), 0 0 0 4px var(--accent);
        }
        html {
            min-height: 100%;
            background-color: var(--bg);
            background-image: url('/background.jpg');
            background-size: cover;
            background-repeat: repeat;
            background-position: 0 0;
            /* "cover" is sized on the page's height by default: while a streamed page (updates,
               imports, favorites refresh) keeps growing, the image kept zooming in. Fixed sizes it
               on the viewport instead, so it stays put whatever the page length. */
            background-attachment: fixed;
        }
        /* Visually hidden until focused: a keyboard/screen-reader user tabbing in from the
           address bar can jump straight past the nav to <main> instead of tabbing through every
           top-level tab link first. Sighted mouse users never see it. */
        .skip-link {
            position: absolute;
            top: -40px;
            left: 8px;
            z-index: 100;
            padding: 8px 16px;
            background-color: var(--text);
            color: var(--bg);
            border-radius: var(--radius-sm);
            text-decoration: none;
        }
        .skip-link:focus {
            top: 8px;
        }
        body {
            color: var(--text);
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
            line-height: 0;
        }
        .header-home {
            display: inline-block;
        }
        .header-logo {
            width: min(360px, 90vw);
            height: auto;
        }
        /* Fixed top-right corner: the Advanced configuration switch, then the running version. */
        .top-right {
            position: fixed;
            top: 8px;
            right: 12px;
            z-index: 10;
            display: flex;
            align-items: center;
            gap: 12px;
        }
        /* On a phone the fixed corner would sit on top of the centered logo: back in the flow,
           right-aligned above the header instead. */
        @media (max-width: 600px) {
            .top-right {
                position: static;
                justify-content: flex-end;
                padding: 8px 12px 0;
            }
        }
        .app-version {
            color: #ff4d4d;
            font-size: 0.8em;
            font-weight: bold;
        }
        /* Segmented-control look: a capsule holding every tab, the active one its own solid pill
           instead of an underline - same black/white/accent palette as everywhere else, just
           more depth (background + shadow) than a flat line ever gave it. */
        .tabs {
            display: inline-flex;
            flex-wrap: wrap;
            justify-content: center;
            gap: 2px;
            margin-top: 16px;
            padding: 4px;
            /* Opaque enough to read over the busy background image, unlike the former 6% white. */
            background-color: var(--surface-strong);
            border: 1px solid var(--border);
            border-radius: 999px;
            /* An inline-flex box (unlike a block-level flex one) shrinks to its content's width
               and is centered by header's own text-align: center - the capsule wraps snugly
               around the tabs instead of stretching edge to edge. max-width keeps a narrow
               viewport from overflowing before flex-wrap gets a chance to break it into rows. */
            max-width: 100%;
        }
        .tabs a {
            display: inline-block;
            padding: 8px 16px;
            color: var(--text-nav);
            text-decoration: none;
            border-radius: 999px;
            transition: color 0.15s ease, background-color 0.15s ease, box-shadow 0.15s ease;
        }
        .tabs a:hover {
            color: var(--text);
            background-color: rgba(255, 255, 255, 0.08);
        }
        .tabs a.active {
            color: var(--bg);
            background-color: var(--text);
            box-shadow: 0 2px 8px rgba(0, 0, 0, 0.35);
        }
        .tabs a.active:hover {
            /* Already the strongest state on the bar - a hover background would just dim the
               solid pill for no reason. */
            background-color: var(--text);
        }
        /* A plain switch, not a tab - it changes which tabs/sections exist. */
        .advanced-toggle {
            margin: 0;
        }
        /* margin-top: overrides the generic "form > button:last-child" spacing, which pushed the
           button below the version next to it. */
        .advanced-toggle > button[type="submit"]:last-child {
            margin-top: 0;
            padding: 4px 12px;
            color: var(--text-nav);
            background-color: var(--surface-strong);
            border: 1px solid var(--border);
            border-radius: 999px;
            font-size: 0.85em;
        }
        .advanced-toggle > button[type="submit"]:hover:not(:disabled) {
            color: var(--text);
            background-color: rgba(255, 255, 255, 0.08);
        }
        .advanced-toggle > button[type="submit"][aria-pressed="true"] {
            color: var(--warn);
            border-color: var(--warn);
        }
        .card {
            background-color: var(--surface);
            border-radius: var(--radius-lg);
            padding: 24px 16px;
            margin-bottom: 24px;
        }
        .card h2 {
            margin-top: 0;
            font-size: 1.1em;
            border-bottom: 1px solid var(--border);
            padding-bottom: 8px;
        }
        a {
            color: var(--accent);
        }
        label {
            display: block;
            margin-top: 16px;
        }
        /* Form controls don't inherit the page font by default: browsers give them their own
           system font at ~13.3px, so on form-heavy pages (My account, sign-in) the typed values
           and button labels came out visibly smaller than the labels/paragraphs around them. */
        input, select, textarea, button {
            font: inherit;
        }
        input, select {
            width: 100%;
            box-sizing: border-box;
            padding: 8px;
            margin-top: 4px;
            transition: outline-color 0.15s ease;
        }
        input:focus, select:focus {
            outline: 2px solid var(--accent);
            outline-offset: -1px;
        }
        button {
            padding: 8px 16px;
            color: #000000;
            background-color: #ffffff;
            border: none;
            border-radius: var(--radius-sm);
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
        /* Every interactive element gets a visible keyboard focus ring, not just input/select
           above: buttons and links used to have none at all, so tabbing through a page (or
           through the primary/sub tabs, both plain <a>) gave no indication of where focus was. */
        a:focus-visible, button:focus-visible, summary:focus-visible {
            outline: 2px solid var(--accent);
            outline-offset: 2px;
        }
        /* Irreversible actions (Danger Zone "Delete the selection" buttons): previously the same
           plain white button as "Save", with nothing to tell them apart at a glance beyond the
           confirm() dialog that fires on click. Same shape/size as a normal button so it doesn't
           jump around the layout, distinct color so the destructive intent is visible before
           that dialog even appears. */
        button.button-danger {
            color: var(--text);
            background-color: var(--danger-strong);
        }
        button.button-danger:hover:not(:disabled) {
            background-color: #d84a3a;
        }
        form > button[type="submit"]:last-child {
            margin-top: 24px;
        }
        .error, .info {
            padding: 10px 14px;
            margin: 12px 0 0;
            border-radius: var(--radius-md);
            border-left: 3px solid currentColor;
        }
        .error {
            color: var(--danger);
            background-color: rgba(255, 107, 107, 0.12);
        }
        .info {
            color: var(--accent);
            background-color: rgba(138, 180, 248, 0.12);
        }
        /* Numbered steps in an info box: keeps room for the markers the .info padding would eat. */
        ol.info {
            padding-left: 34px;
        }
        ol.info li + li {
            margin-top: 6px;
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
        .plugins-path-field {
            transition: opacity 0.15s ease;
        }
        .plugins-path-field.is-disabled {
            opacity: 0.4;
        }
        .button-row {
            display: flex;
            flex-wrap: wrap;
            gap: 8px;
            margin-top: 24px;
        }
        /* Subtabs on the left, the page's action (see renderSubtabbedPage()'s navAction) pinned to
           the right of the same row; wraps under them on a narrow screen. */
        /* Sticky: the MAME launch/close button stays in reach while scrolling a long subtab (the
           Gamepads tables especially). */
        .subtabs-bar {
            position: sticky;
            top: 0;
            z-index: 10;
            padding: 8px 0;
            background-color: var(--surface-strong);
            display: flex;
            flex-wrap: wrap;
            align-items: center;
            justify-content: space-between;
            gap: 8px 16px;
            margin: 4px 0 20px;
        }
        .subtabs-bar .subtabs {
            margin: 0;
        }
        .subtabs-action form > button[type="submit"]:last-child {
            margin-top: 0;
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
        .hi-badge {
            margin-left: 6px;
            padding: 0 5px;
            border: 1px solid var(--success);
            border-radius: 3px;
            color: var(--success);
            font-size: 11px;
            vertical-align: middle;
        }
        .checkbox-row-detail {
            display: block;
            margin-top: 2px;
            color: var(--text-muted);
            font-size: 0.9em;
        }
        .current-path {
            font-family: monospace;
            word-break: break-all;
            background-color: var(--surface-inset);
            padding: 8px;
        }
        .info-field {
            margin-top: 12px;
        }
        .info-field dt {
            font-size: 0.85em;
            color: var(--text-muted);
        }
        .info-field dd {
            margin: 4px 0 0;
            font-family: monospace;
            word-break: break-all;
            background-color: var(--surface-inset);
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
            border-bottom: 1px solid var(--border-subtle);
        }
        .table-wrap {
            overflow-x: auto;
        }
        table.favorites-table {
            width: 100%;
            border-collapse: collapse;
            font-size: 0.85em;
        }
        table.favorites-table th,
        table.favorites-table td {
            text-align: left;
            padding: 6px 8px;
            border-bottom: 1px solid var(--border-subtle);
            white-space: nowrap;
        }
        /* Favorites / removed favorites: every column but the name has a fixed width, pinned to
           the right whatever the names are; the name gets what's left and is cut with an ellipsis
           (see .game-name-cell). min-width: below it the table scrolls (.table-wrap) instead of
           squeezing the name column to nothing. */
        table.favorites-table.fixed-columns {
            table-layout: fixed;
            min-width: 640px;
        }
        table.favorites-table.fixed-columns td {
            overflow: hidden;
            text-overflow: ellipsis;
        }
        table.favorites-table.fixed-columns .game-name-cell {
            max-width: none;
        }
        table.favorites-table.fixed-columns .romname-cell {
            display: flex;
            min-width: 0;
        }
        .col-romname { width: 130px; }
        .col-assets { width: 88px; }
        .col-date { width: 140px; }
        .col-plays { width: 64px; }
        .col-vote { width: 140px; }
        .col-action { width: 56px; }
        table.favorites-table th.center,
        table.favorites-table td.center {
            text-align: center;
        }
        .badge-yes {
            color: var(--success);
        }
        .badge-no {
            color: var(--danger);
        }
        .badge-deleted {
            color: var(--text-muted);
        }
        /* Deleted players, listed after the others in the same Players table (Advanced configuration only). */
        table.favorites-table tr.row-deleted td {
            opacity: 0.6;
        }
        table.favorites-table tr.row-deleted td:last-child {
            opacity: 1;
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
        .asset-icon[data-preview] {
            cursor: zoom-in;
        }
        .asset-preview {
            position: fixed;
            z-index: 50;
            max-width: 240px;
            max-height: 180px;
            object-fit: contain;
            padding: 4px;
            background-color: var(--surface);
            border: 1px solid var(--border);
            border-radius: var(--radius-sm);
            box-shadow: 0 4px 16px rgba(0, 0, 0, 0.5);
            pointer-events: none;
        }
        /* Icon-only submit button (favorites Remove/Restore): compact, outlined in its own color
           instead of the plain white button. The extra selector parts beat the generic
           "form > button[type=submit]:last-child" 24px top margin above, which would otherwise
           push it out of its table row's alignment. */
        form > button.icon-button[type="submit"]:last-child {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            /* Was padding: 5px (~26px total with the 16px icon) - under the ~40-44px touch
               target guideline, and this sits in dense table rows on a BO reachable from any
               phone/tablet on the LAN. Not raised all the way to 44px here: that would need
               revisiting row height/density across every table this appears in (Favorites,
               Players, removed-favorites...), left for the Phase 2 pass in
               docs/BO-UX-REVAMP.md. min-width/height (not just padding) keep it square even
               though the icon itself doesn't fill the box uniformly. */
            min-width: 32px;
            min-height: 32px;
            padding: 8px;
            margin-top: 0;
            color: var(--danger);
            background-color: transparent;
            border: 1px solid currentColor;
        }
        form > button.icon-button.icon-button-ok[type="submit"]:last-child {
            color: var(--success);
        }
        form > button.icon-button.icon-button-warn[type="submit"]:last-child {
            color: var(--warn);
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
            background: var(--border-subtle);
            color: #888888;
            font-size: 18px;
        }
        .avatar-upload {
            display: inline-block;
            /* A <label>: the generic label rule's 16px top margin pushed the avatar down its row. */
            margin-top: 0;
            vertical-align: middle;
            position: relative;
            cursor: pointer;
            border-radius: 4px;
        }
        /* A bare avatar (deleted players, not uploadable): display: block ignores the cell's
           text-align, so it's centered by margin to line up with the .avatar-upload ones. */
        td.center > .avatar-thumb {
            margin: 0 auto;
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
            color: var(--accent);
            cursor: help;
        }
        /* Long game names are cut with an ellipsis instead of widening the table; the info icon
           stays visible after the cut text. */
        .vote-buttons {
            display: inline-flex;
            gap: 6px;
        }
        /* The three vote icons of a row: unlike the single Remove/Restore button above (styled as a
           form's :last-child), each needs the icon-button look. The selected one is lit up in its
           own color, the others stay grey. */
        form.vote-buttons > button.icon-button[type="submit"] {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            min-width: 32px;
            min-height: 32px;
            padding: 8px;
            margin-top: 0;
            color: #777777;
            background-color: transparent;
            border: 1px solid #444444;
        }
        form.vote-buttons > button.icon-button[aria-pressed="true"] {
            border-color: currentColor;
            background-color: rgba(255, 255, 255, 0.08);
        }
        form.vote-buttons > button.up[aria-pressed="true"] {
            color: var(--success);
        }
        form.vote-buttons > button.neutral[aria-pressed="true"] {
            color: var(--warn);
        }
        form.vote-buttons > button.down[aria-pressed="true"] {
            color: var(--danger);
        }

        .game-name-cell {
            display: flex;
            align-items: center;
            gap: 6px;
            max-width: 360px;
        }
        .game-name-text {
            min-width: 0;
            overflow: hidden;
            text-overflow: ellipsis;
        }
        .romname-cell {
            display: inline-flex;
            align-items: center;
            gap: 6px;
        }
        .game-category-icon {
            flex: 0 0 auto;
            width: 20px;
            height: 20px;
        }
        .romname-cell .info-icon,
        .game-name-cell .info-icon,
        .game-name-cell .hiscore-icon {
            flex: 0 0 auto;
        }
        .hiscore-icon {
            display: inline-flex;
            color: #ffd700;
            cursor: help;
        }
        .found-icon {
            display: inline-flex;
            vertical-align: middle;
            flex-shrink: 0;
            margin-right: 6px;
        }
        .found-yes {
            color: var(--success);
        }
        .found-no {
            color: var(--danger);
        }
        .disk-bar-track {
            display: flex;
            height: 22px;
            margin: 8px 0;
            background-color: var(--surface-inset);
            border: 1px solid var(--border);
            border-radius: 11px;
            overflow: hidden;
        }
        .disk-bar-track.disk-bar-overflow {
            border-color: var(--danger);
            box-shadow: 0 0 0 1px var(--danger);
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
            color: var(--accent);
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
            color: var(--accent);
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
        .pack-search, .table-search {
            margin: 16px 0 0;
        }
        .table-search-controls {
            display: flex;
            flex-wrap: wrap;
            gap: 8px;
        }
        .table-search-controls input {
            flex: 1 1 240px;
        }
        .table-search-controls input, .table-search-controls select {
            margin-top: 0;
        }
        .table-search-controls select {
            width: auto;
            flex: 0 1 auto;
        }
        .table-pager {
            display: flex;
            flex-wrap: wrap;
            align-items: center;
            justify-content: flex-end;
            gap: 8px;
            margin-top: 12px;
        }
        .table-pager label {
            margin-top: 0;
        }
        .table-pager select {
            width: auto;
            margin-top: 0;
        }
        .table-pager button {
            padding: 4px 12px;
        }
        .pack-search-count, .table-search-count {
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
            color: var(--text-muted);
        }
        .pack-game-installed .pack-game-mark {
            color: var(--success);
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
            color: var(--text-muted);
        }
        .pack-status-owned {
            color: var(--success);
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
        dialog.modal {
            width: min(560px, 92vw);
            padding: 16px 20px 20px;
            color: var(--text);
            background-color: var(--surface);
            border: 1px solid var(--border);
            border-radius: var(--radius-lg);
            box-shadow: 0 8px 32px rgba(0, 0, 0, 0.6);
        }
        dialog.modal::backdrop {
            background-color: rgba(0, 0, 0, 0.6);
        }
        .modal-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 16px;
        }
        .modal-header h3 {
            margin: 0;
        }
        button.modal-close {
            padding: 0 10px;
            font-size: 1.5em;
            line-height: 1.4;
            color: var(--text);
            background-color: transparent;
        }
        button.modal-close:hover:not(:disabled) {
            background-color: rgba(255, 255, 255, 0.12);
        }
        dialog.modal progress {
            width: 100%;
            margin-top: 16px;
        }
        p.modal-done {
            color: var(--success);
            font-weight: bold;
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
            background-color: var(--surface-inset);
            border: 1px solid var(--border);
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
            background-color: var(--accent);
            transition: width 0.25s ease-out;
        }
        .progress-fill.progress-done {
            background-color: var(--success);
        }
        .progress-fill.progress-failed {
            background-color: var(--danger);
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
            border-bottom: 1px solid var(--border-subtle);
        }
        .progress-log li:last-child {
            animation: pulse 1s ease-in-out infinite;
        }
        @keyframes pulse {
            0%, 100% { opacity: 1; }
            50% { opacity: 0.4; }
        }
        /* Present once a page has subtabs (see renderSubtabbedPage()) - the primary nav steps
           back (muted except the active tab) so the subtabs row below reads as the primary
           navigation for the page actually being looked at, without hiding the way back to the
           other top-level tabs. Dimmed only, not shrunk: a smaller font/padding here made the
           whole menu visibly jump in size between pages with subtabs and pages without
           (My account, single-section tabs). */
        .tabs.compact a:not(.active) {
            /* Muted color rather than opacity: 55% opacity over the capsule made the labels
               unreadable. */
            color: var(--text-muted);
        }
        .tabs.compact a:not(.active):hover {
            color: var(--text);
        }
        /* Multi-pack import (see renderImportTabsOpen()): one tab per pack, the pack's own
           progress in the panel below. Buttons, unlike the .tabs links, so the generic white
           button style is reset here. */
        .import-tabs {
            display: flex;
            flex-wrap: wrap;
            gap: 4px;
            margin: 4px 0 16px;
            border-bottom: 1px solid var(--border);
        }
        .import-tab {
            padding: 6px 12px;
            color: var(--text-muted);
            background-color: transparent;
            border-radius: 0;
            border-bottom: 2px solid transparent;
            font-size: 0.85em;
        }
        .import-tab:hover:not(:disabled) {
            color: #ffffff;
            background-color: transparent;
        }
        .import-tab.active {
            color: #ffffff;
            border-bottom-color: var(--accent);
        }
        .import-tab.running::before { content: '\\25CF '; color: var(--accent); }
        .import-tab.done::before { content: '\\2713 '; color: var(--success); }
        .import-tab.failed::before { content: '\\2717 '; color: var(--danger); }
        .import-panel h3 {
            margin: 0 0 8px;
            font-size: 1em;
        }
        /* Same segmented-control family as .tabs above, one size down and left-aligned (it's a
           page's own secondary nav, not the site-wide one) - and its active pill is the accent
           color rather than plain white, so the two levels stay visually distinct: white pill =
           which top-level tab, blue pill = which subtab within it. Accent was already this row's
           "you are here" color before (the old underline), just applied to a filled pill now. */
        .subtabs {
            display: inline-flex;
            flex-wrap: wrap;
            gap: 2px;
            margin: 4px 0 20px;
            padding: 3px;
            background-color: rgba(255, 255, 255, 0.04);
            border: 1px solid var(--border-subtle);
            border-radius: 999px;
            animation: subtabs-slide-in 0.2s ease-out;
        }
        @keyframes subtabs-slide-in {
            from { opacity: 0; transform: translateX(-16px); }
            to { opacity: 1; transform: translateX(0); }
        }
        .subtabs a {
            display: inline-block;
            padding: 6px 14px;
            color: var(--text-nav);
            text-decoration: none;
            border-radius: 999px;
            font-size: 0.9em;
            transition: color 0.15s ease, background-color 0.15s ease;
        }
        .subtabs a:hover {
            color: var(--text);
            background-color: rgba(255, 255, 255, 0.08);
        }
        .subtabs a.active {
            color: var(--bg);
            background-color: var(--accent);
        }
        .subtabs a.active:hover {
            background-color: var(--accent);
        }
        /* Player switcher inside the Gamepads cards (see renderPlayerTabs()) - same pill look as
           .subtabs above, one level down. */
        .player-tabs {
            display: inline-flex;
            flex-wrap: wrap;
            gap: 2px;
            margin: 16px 0 12px;
            padding: 3px;
            background-color: rgba(255, 255, 255, 0.04);
            border: 1px solid var(--border-subtle);
            border-radius: 999px;
        }
        .player-tabs button {
            padding: 6px 14px;
            color: var(--text-nav);
            background-color: transparent;
            border-radius: 999px;
            font-size: 0.9em;
        }
        .player-tabs button:hover:not(:disabled) {
            color: var(--text);
            background-color: rgba(255, 255, 255, 0.08);
        }
        .player-tabs button.active, .player-tabs button.active:hover:not(:disabled) {
            color: var(--bg);
            background-color: var(--accent);
        }
        /* One small card per command in the Gamepads input configuration cards: as many per row
           as fit (2-3 on a desktop window), down to one per row on a phone. min(100%, ...) keeps
           a lone column from overflowing a screen narrower than the minimum. */
        .binding-grid {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(min(100%, 300px), 1fr));
            gap: 12px;
        }
        /* Values and buttons on the left, the command's icon and name on the right (spanning
           both rows), a flash message across the whole card under them. */
        .binding {
            display: grid;
            grid-template-columns: 1fr auto;
            gap: 8px 12px;
            align-content: start;
            padding: 12px;
            background-color: var(--surface-inset);
            border: 1px solid var(--border-subtle);
            border-radius: var(--radius-md);
        }
        .binding > * {
            grid-column: 1;
        }
        .binding-label {
            grid-column: 2;
            grid-row: 1 / span 2;
            display: flex;
            flex-direction: column;
            align-items: center;
            max-width: 96px;
            font-size: 0.8em;
            font-weight: bold;
            text-align: center;
            color: var(--text-muted);
        }
        .binding-icon {
            width: 64px;
            height: 64px;
        }
        .binding-values {
            display: grid;
            grid-template-columns: auto 1fr;
            gap: 4px 12px;
            margin: 0;
            font-size: 0.9em;
        }
        .binding-values dt {
            color: var(--text-muted);
        }
        .binding-values dd {
            margin: 0;
            /* Sequences like "KEYCODE_TAB NOT KEYCODE_LALT NOT KEYCODE_RALT" have no natural
               break point. */
            overflow-wrap: anywhere;
        }
        .binding-actions {
            display: flex;
            flex-wrap: wrap;
            align-items: flex-start;
            align-self: start;
            gap: 8px;
        }
        .binding-actions > button[type="submit"]:last-child {
            margin-top: 0;
        }
        .binding .flash {
            grid-column: 1 / -1;
            margin: 0;
        }
        /* Gamepads tab's "Detected devices": one card per device MAME reports, same inset look
           as the binding cards. */
        .device-grid {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(min(100%, 320px), 1fr));
            gap: 12px;
            margin-top: 16px;
        }
        .device {
            display: flex;
            flex-direction: column;
            gap: 12px;
            padding: 16px;
            background-color: var(--surface-inset);
            border: 1px solid var(--border-subtle);
            border-left: 4px solid var(--success);
            border-radius: var(--radius-md);
        }
        .device-header {
            display: flex;
            flex-wrap: wrap;
            align-items: center;
            gap: 8px 12px;
        }
        .device-header h3 {
            flex: 1;
            margin: 0;
            font-size: 1.15em;
        }
        /* MAME's player-facing number for the device - the first thing to read on the card. */
        .device-joy {
            padding: 4px 10px;
            border-radius: var(--radius-sm);
            background-color: var(--accent);
            color: var(--bg);
            font-weight: bold;
            white-space: nowrap;
        }
        .device-pinned {
            padding: 2px 8px;
            border: 1px solid var(--success);
            border-radius: var(--radius-sm);
            color: var(--success);
            font-size: 0.8em;
        }
        .device-pin {
            align-items: center;
        }
        .device-pin-label {
            color: var(--text-muted);
            font-size: 0.9em;
        }
        .device-absent-title {
            margin: 24px 0 8px;
            font-size: 1em;
        }
        .device-absent {
            margin: 0;
            padding: 0;
            list-style: none;
        }
        .device-absent li {
            display: flex;
            flex-wrap: wrap;
            align-items: center;
            gap: 8px 12px;
            padding: 8px 0;
            border-bottom: 1px solid var(--border-subtle);
        }
        .device-absent code {
            flex: 1;
            overflow-wrap: anywhere;
        }
        .device-absent form > button[type="submit"]:last-child {
            margin-top: 0;
        }
        .device details summary {
            cursor: pointer;
            color: var(--text-muted);
            font-size: 0.9em;
        }
        .device-items {
            display: flex;
            flex-wrap: wrap;
            gap: 4px;
            margin-top: 8px;
            font-size: 0.85em;
        }
        .player-panel {
            display: none;
        }
        .player-panel.active {
            display: block;
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
    <a class="skip-link" href="#main">Skip to content</a>
    <div class="top-right">
        ${viewer ? `<form method="post" action="/advanced" class="advanced-toggle">
            <button type="submit" aria-pressed="${viewer === 'advanced'}"
                title="${viewer === 'advanced' ? 'Hide' : 'Show'} ScreenScraper, Repository, Danger and the other rarely needed settings">
                Advanced configuration: ${viewer === 'advanced' ? 'on' : 'off'}
            </button>
        </form>` : ''}
        <span class="app-version" title="Running version">v${escapeHtml(getRunningVersion())}</span>
    </div>
    <header>
        <h1><a class="header-home" href="/" title="Home"><img class="header-logo" src="/maui-logo.png" alt="mame-awesome-ui"></a></h1>
        ${viewer ? `<nav class="tabs${hasSubtabs ? ' compact' : ''}" aria-label="Primary">
            ${renderNavTabLink('/', 'MAME', active === 'mame')}
            ${renderNavTabLink('/favorites', 'Games', active === 'favorites')}
            ${renderNavTabLink('/users', 'Players', active === 'users')}
            ${viewer === 'advanced' ? renderNavTabLink('/screenscraper', 'ScreenScraper', active === 'screenscraper') : ''}
            ${renderNavTabLink('/maui', 'MAUI', active === 'maui')}
            ${renderNavTabLink('/account', 'My account', active === 'account')}
        </nav>` : ''}
    </header>
    <main id="main">
    `;
}

function renderPageTail(): string {
    return `
    </main>
    <script>
        // Most forms here are POSTs whose response is the exact same full-page HTML a GET would
        // render (see e.g. renderFavoritesTab()) - the server has no separate "fragment" vs
        // "whole page" response shape. That let every one of them respond in place instead of
        // navigating: intercept the submit, POST via fetch(), then replace the document with
        // whatever HTML comes back. The address bar never leaves the GET page it started on, so
        // refreshing afterward re-runs that GET, not the action - previously every action left
        // the browser sitting on its own POST URL, and a refresh there replayed it (a delete, a
        // vote, a save... whatever the last click was), because the server had no
        // Post/Redirect/Get in place. This fixes that for free, without touching any of those
        // handlers, since the response they already send is exactly what gets displayed either
        // way.
        //
        // Left alone (see the data-stream check below): forms whose POST response is a
        // multi-chunk res.write() stream the browser paints incrementally as it arrives (long
        // imports, favorites refresh, media download, self-update) - swapping those in only once
        // the whole fetch() resolves would throw away the "watch it happen live" log entirely.
        // Those still fully navigate, so they keep the older replay-on-refresh gap for now (see
        // docs/BO-UX-REVAMP.md) until they're worth teaching this same script to read
        // fetch()'s response body as a stream instead of a single text() blob.
        document.addEventListener('submit', function (event) {
            if (event.defaultPrevented) {
                return;
            }
            var form = event.target;
            var button = event.submitter; // null for a plain requestSubmit() with no argument.
            // A submitter's formmethod/formaction override the form's own - same resolution a
            // real submission would use (the Browse buttons rely on exactly this to GET /browse
            // instead of POSTing the form they sit in).
            var method = ((button && button.getAttribute('formmethod')) || form.getAttribute('method') || 'get')
                .toLowerCase();
            if (method !== 'post') {
                return; // A GET is always safe to reload - no need to intercept it.
            }
            var eligible = button && button.tagName === 'BUTTON' && !button.disabled;
            // An icon-only button has no text to relabel (assigning textContent would replace
            // its <svg> with a bare "…") - just disabling it is feedback enough.
            var relabel = eligible && !button.classList.contains('icon-button');
            var originalText = eligible ? button.textContent : null;

            if (form.hasAttribute('data-stream')) {
                // Real navigation is still happening (see the comment above the listener). The
                // mutation itself is deferred one tick instead of applied synchronously here:
                // Chrome submits a form on Enter by internally simulating a click on its default
                // button, and disabling that same button synchronously from within the 'submit'
                // event it's still in the middle of dispatching aborts that in-flight click, so
                // the submission silently never happens (keyboard-only "press Enter" submission
                // broke this way, reported against exactly this symptom on the login page - a
                // real pointer click isn't affected, its own default action already committed
                // before 'submit' fires). Deferring lets the browser finish submitting first
                // either way. No need to re-enable it afterward: the navigation this triggers
                // replaces the whole DOM.
                if (eligible) {
                    setTimeout(function () {
                        if (relabel) {
                            button.textContent = originalText + '…';
                        }
                        button.disabled = true;
                    }, 0);
                }
                return;
            }

            event.preventDefault();
            if (eligible) {
                if (relabel) {
                    button.textContent = originalText + '…';
                }
                button.disabled = true;
            }
            var action = (button && button.getAttribute('formaction')) || form.getAttribute('action') || location.href;
            // A <form> with no enctype (nearly all of them: login, favorites, users, saves...)
            // submits as application/x-www-form-urlencoded, which express.urlencoded() (the only
            // body parser mounted for those routes) expects - passing a FormData body to fetch()
            // always sends multipart/form-data instead, regardless of the form's own enctype,
            // which left req.body undefined on every route without its own multer instance (only
            // the handful of file-upload routes have one). URLSearchParams as the body keeps the
            // encoding those routes actually expect; only the enctype="multipart/form-data" forms
            // (the file uploads) still need a real FormData.
            var enctype = (button && button.getAttribute('formenctype')) || form.getAttribute('enctype') || '';
            var body;
            if (enctype === 'multipart/form-data') {
                body = new FormData(form);
                if (button && button.name) {
                    // Native submission includes the clicked submit button's own name/value
                    // (several forms tell apart which of theirs was pressed this way, e.g. the
                    // Browse buttons' "target" field) - FormData(form)/URLSearchParams alone
                    // don't add it.
                    body.append(button.name, button.value);
                }
            } else {
                body = new URLSearchParams();
                new FormData(form).forEach(function (value, key) {
                    if (typeof value === 'string') {
                        body.append(key, value);
                    }
                });
                if (button && button.name) {
                    body.append(button.name, button.value);
                }
            }
            var scrollY = window.scrollY;
            fetch(action, {method: 'POST', body: body})
                .then(function (response) {
                    // A handful of these (login, logout, /repo/save) res.redirect() elsewhere on
                    // success instead of responding in place - fetch() follows that transparently,
                    // so response.redirected/response.url say where it actually ended up. Those
                    // belong on the address bar for real (e.g. landing on "/" after signing in),
                    // unlike every in-place response above: a real navigation there also sidesteps
                    // the GET /login page's own gap (it doesn't redirect an already-authenticated
                    // visitor away by itself), and refreshing a real URL is always safe anyway.
                    if (response.redirected) {
                        location.href = response.url;
                        return null;
                    }
                    return response.text();
                })
                .then(function (html) {
                    if (html === null) {
                        return;
                    }
                    // Full-document replacement, not innerHTML: the response is a complete
                    // <!DOCTYPE html>...</html> page (styles, nav, every inline <script> below
                    // included), same as a real navigation would have rendered - this makes the
                    // browser parse it as one, scripts included, without ever changing the URL.
                    document.open();
                    document.write(html);
                    document.close();
                    window.scrollTo(0, scrollY);
                })
                .catch(function () {
                    if (eligible) {
                        button.disabled = false;
                        if (relabel) {
                            button.textContent = originalText;
                        }
                    }
                    alert('Could not reach the application - check your connection and try again.');
                });
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
                    var selected = link.dataset.subtab === id;
                    link.classList.toggle('active', selected);
                    // Keeps the ARIA tab state (and Tab-key stops) in sync with which panel is
                    // actually visible - see renderSubtabbedPage()'s nav markup, which starts
                    // every link at aria-selected="false"/tabindex="-1" until this runs.
                    link.setAttribute('aria-selected', selected ? 'true' : 'false');
                    link.tabIndex = selected ? 0 : -1;
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

        // A form POST replaces the whole page, and a browser opens the result at the top - however
        // far down the button that was just clicked sat. Remember the scroll position when a form
        // is submitted and put it back on the page that comes back, provided it is the same page
        // and subtab (a different one - a login redirect, an error landing elsewhere - makes the
        // old position meaningless). Read after the subtab script above: a hidden panel has no
        // height to scroll into. Kept for a couple of minutes at most (a capture waits up to 30s,
        // a MAME launch a few more), and consumed once.
        (function () {
            var KEY = 'boScrollRestore';
            function where() {
                var tab = document.querySelector('nav.tabs a.active');
                var subtab = document.querySelector('.subtabs a.active');
                return (tab ? tab.textContent : '') + '/' + (subtab ? subtab.dataset.subtab : '');
            }
            document.addEventListener('submit', function (event) {
                if (event.defaultPrevented) {
                    return;
                }
                try {
                    sessionStorage.setItem(KEY, JSON.stringify({y: window.scrollY, where: where(), at: Date.now()}));
                } catch (error) { /* storage blocked: the page just opens at the top */ }
            });
            try {
                var saved = JSON.parse(sessionStorage.getItem(KEY) || 'null');
                sessionStorage.removeItem(KEY);
                if (saved && Date.now() - saved.at < 120000 && saved.where === where()) {
                    window.scrollTo(0, saved.y);
                }
            } catch (error) { /* nothing to restore */ }
        })();

        // Player switchers of the Gamepads cards (see renderPlayerTabs()). Opens on the tab the
        // server asks for (data-active: the one holding the command just captured/reset), else
        // the last one picked in this card (kept across the page swaps every form submission
        // does), else the first.
        (function () {
            document.querySelectorAll('[data-player-tabs]').forEach(function (bar) {
                var card = bar.dataset.playerTabs;
                var key = 'boPlayerTab:' + card;
                var buttons = bar.querySelectorAll('[data-player-tab]');
                var panels = document.querySelectorAll('[data-player-panel^="' + card + ':"]');
                function activate(id) {
                    buttons.forEach(function (button) {
                        var selected = button.dataset.playerTab === id;
                        button.classList.toggle('active', selected);
                        button.setAttribute('aria-selected', selected ? 'true' : 'false');
                    });
                    panels.forEach(function (panel) {
                        panel.classList.toggle('active', panel.dataset.playerPanel === card + ':' + id);
                    });
                    try {
                        sessionStorage.setItem(key, id);
                    } catch (error) { /* storage blocked: back to the first tab next time */ }
                }
                buttons.forEach(function (button) {
                    button.addEventListener('click', function () {
                        activate(button.dataset.playerTab);
                    });
                });
                var saved = null;
                try {
                    saved = sessionStorage.getItem(key);
                } catch (error) { /* nothing remembered */ }
                var ids = Array.prototype.map.call(buttons, function (button) { return button.dataset.playerTab; });
                activate([bar.dataset.active, saved].find(function (id) { return id && ids.indexOf(id) !== -1; }) || ids[0]);
            });
        })();

        // While a MAME config session runs (the Gamepads tab marks it with data-mame-session),
        // ask the server every couple of seconds whether it's still alive, and reload the page
        // once it isn't - MAME can be closed from its own window, which the server-rendered
        // "Close MAME" buttons and "running" status would otherwise keep showing. The interval
        // handle lives on window, not in this closure: a form submission swaps the document in
        // place (document.write() above) without clearing the previous page's timers, so each
        // new page first stops the one before it.
        (function () {
            clearInterval(window.boMameSessionWatch);
            if (!document.querySelector('[data-mame-session="running"]')) {
                return;
            }
            window.boMameSessionWatch = setInterval(function () {
                fetch('/input-probe/mame/status')
                    .then(function (response) { return response.ok ? response.json() : null; })
                    .then(function (status) {
                        if (!status || status.running) {
                            return;
                        }
                        clearInterval(window.boMameSessionWatch);
                        // Same entry the scroll-restore script above reads, so the reloaded page
                        // opens where this one was; the hash keeps it on this subtab.
                        try {
                            var subtab = document.querySelector('.subtabs a.active');
                            var tab = document.querySelector('nav.tabs a.active');
                            sessionStorage.setItem('boScrollRestore', JSON.stringify({
                                y: window.scrollY,
                                where: (tab ? tab.textContent : '') + '/' + (subtab ? subtab.dataset.subtab : ''),
                                at: Date.now(),
                            }));
                            if (subtab) {
                                history.replaceState(null, '', '#' + subtab.dataset.subtab);
                            }
                        } catch (error) { /* the page just reloads at the top */ }
                        location.reload();
                    })
                    .catch(function () { /* server unreachable for now - try again next tick */ });
            }, 2000);
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
    `, 'mame', null);
}

function renderAccountPage(
    username: string, viewer: Viewer, mustChangePassword: boolean, error?: string, info?: string,
): string {
    return renderPage(`
        <section class="card">
            <h2>My account</h2>
            <p>Signed in as <strong>${escapeHtml(username)}</strong>.</p>
            ${mustChangePassword ? `<p class="error flash">You are using the default password.
            Choose a new one to continue: it also encrypts the saved credentials.</p>` : ''}
            ${error ? `<p class="error flash">${escapeHtml(error)}</p>` : ''}
            ${info ? `<p class="info flash">${escapeHtml(info)}</p>` : ''}
            <form method="post" action="/account/password">
                <label for="currentPassword">Current password</label>
                <input type="password" id="currentPassword" name="currentPassword" required>
                <label for="newPassword">New password</label>
                <input type="password" id="newPassword" name="newPassword" required minlength="${MIN_BO_PASSWORD_LENGTH}">
                <label for="confirmPassword">Confirm the new password</label>
                <input type="password" id="confirmPassword" name="confirmPassword" required minlength="${MIN_BO_PASSWORD_LENGTH}">
                <button type="submit">Change password</button>
            </form>
        </section>
        <section class="card">
            <form method="post" action="/logout">
                <button type="submit">Sign out</button>
            </form>
        </section>
    `, 'account', viewer);
}

interface ConfigFormValues {
    mamePath: string;
}

/**
 * mame binary folder, then the mame.ini options: the plugins folder (pluginspath - the saved
 * value, or the one just picked with Browse) and fullscreen (window, inverted - same wording as
 * the MAUI tab's own fullscreen option). Those stay dimmed and
 * disabled while the binary folder is empty - mame.ini only exists once the binary is known (see
 * POST /save) - and are re-enabled as soon as something is typed into it.
 */
function renderConfigCard(
    values: ConfigFormValues, mameInfo: Pick<MameInfo, 'pluginsPath' | 'windowed'>, error?: string, info?: string,
): string {
    const {pluginsPath, windowed} = mameInfo;
    const pluginsDisabled = values.mamePath.trim() ? '' : ' disabled';
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
                <div class="plugins-path-field${pluginsDisabled ? ' is-disabled' : ''}" id="pluginsPathField">
                    <label for="pluginsPath">MAME plugins folder (pluginspath)</label>
                    <div class="path-row">
                        <input type="text" id="pluginsPath" name="pluginsPath" value="${escapeHtml(pluginsPath || '')}"${pluginsDisabled}>
                        <button type="submit" name="target" value="pluginsPath" formaction="/browse" formmethod="get"${pluginsDisabled}>Browse</button>
                    </div>
                    <label class="checkbox-row">
                        <input type="checkbox" name="fullscreen" ${windowed ? '' : 'checked'}${pluginsDisabled}>
                        Launch MAME fullscreen (unchecked = windowed)
                    </label>
                </div>
                <script>(function () {
                    var mamePath = document.getElementById('mamePath');
                    var field = document.getElementById('pluginsPathField');
                    function sync() {
                        var disabled = !mamePath.value.trim();
                        field.classList.toggle('is-disabled', disabled);
                        field.querySelectorAll('input, button').forEach(function (control) { control.disabled = disabled; });
                    }
                    mamePath.addEventListener('input', sync);
                })();</script>
                <div class="button-row">
                    <button type="submit">Save</button>
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
                    <dt>Subgenres file (catver.ini, categorypath)</dt>
                    <dd>${renderFoundIcon(!!mameInfo.catverIniPath)}${mameInfo.catverIniPath
                        ? escapeHtml(mameInfo.catverIniPath) + ' <em>(used instead of genre.ini)</em>'
                        : '<em>Optional — add progettoSNAPS\' catver.ini at the path given by '
                            + 'categorypath in ui.ini for finer genres (Fighting, Beat \'em Up...).</em>'}</dd>
                </div>
                <div class="info-field">
                    <dt>Player count file (Multiplayer.ini, categorypath)</dt>
                    <dd>${renderFoundIcon(!!mameInfo.nplayersIniPath)}${mameInfo.nplayersIniPath
                        ? escapeHtml(mameInfo.nplayersIniPath)
                        : '<em>Not found — import a starting pack (Import tab) to '
                            + 'install it at the path given by categorypath in ui.ini.</em>'}</dd>
                </div>
            </dl>
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
 * Directory mame's hiscore plugin writes .hi files into (the one @arcadoolic/mhiex reads from,
 * see HiscoreService.class.ts). Duplicated here rather than imported for the same
 * @electron/remote reason as the rest of this file's helpers.
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
                <button type="submit" class="button-danger">Delete the selection</button>
            </form>
        </section>
    `;
}

interface DeviceProbeRow {
    name: string;
    id: string;
    // "<item display name>=<MAME token>" pairs, e.g. "LB=BUTTON5" - kept as raw strings rather
    // than split further, this is a basic detection test, not a mapping UI yet.
    items: string[];
    // The number MAME gives the device in its input codes, e.g. "JOYCODE_1" - empty if unknown.
    joycode: string;
}

interface DeviceProbeState {
    result?: DeviceProbeRow[];
    error?: string;
    info?: string;
}

/**
 * Line-based parse of device-probe.lua's stdout, captured amid MAME's normal boot chatter (menu
 * hints, warnings, etc. on other lines - anything not starting with the marker is ignored).
 * Format, one line per device: MAUI_DEVICE_ROW|<device name>|<device id>|<name>=<token>,...|<JOYCODE_n>
 */
function parseDeviceProbeOutput(stdout: string): DeviceProbeRow[] {
    const rows: DeviceProbeRow[] = [];
    for (const line of stdout.split('\n')) {
        if (!line.startsWith('MAUI_DEVICE_ROW|')) {
            continue;
        }
        const [, name, id, itemsRaw, joycode] = line.split('|');
        rows.push({
            name: name ?? '',
            id: id ?? '',
            items: itemsRaw ? itemsRaw.split(',').filter(Boolean) : [],
            joycode: /^JOYCODE_\d+$/.test(joycode?.trim() ?? '') ? joycode.trim() : '',
        });
    }
    // Same order as MAME's own "JOY 1", "JOY 2"... (unknown numbers last).
    return rows.sort((a, b) => joycodeNumber(a.joycode) - joycodeNumber(b.joycode));
}

function joycodeNumber(joycode: string): number {
    return Number(/^JOYCODE_(\d+)$/.exec(joycode)?.[1] ?? Infinity);
}

/**
 * The controller file (see MameCtrlr.ts) the Gamepads tab pins devices to their JOYCODE number
 * in: whichever one mame.ini's `ctrlr` already names, else "maui" (set in mame.ini on the first
 * pin, so every MAME launch - kiosk, BO probes and sessions - loads it). Resolved under the first
 * entry of `ctrlrpath`, relative to the mame home like every launch's cwd.
 */
const DEFAULT_CTRLR_NAME = 'maui';

function getCtrlrFile(mameInfo: MameInfo): {name: string; path: string; enabled: boolean} {
    const configured = getMameIniValue(mameInfo.mameIniPath, 'ctrlr')?.replace(/^"|"$/g, '') || '';
    const name = configured || DEFAULT_CTRLR_NAME;
    const ctrlrPath = mameInfo.showConfig?.ctrlrpath?.[0] || getMameIniValue(mameInfo.mameIniPath, 'ctrlrpath') || 'ctrlr';
    return {
        name,
        path: join(resolveDirectoryPath(ctrlrPath, mameInfo.iniPath), `${name}.cfg`),
        enabled: !!configured,
    };
}

/** Device id pinned to each JOYCODE number - only once mame.ini actually loads the file. */
function readPinnedDevices(mameInfo: MameInfo): Map<string, string> {
    const ctrlr = getCtrlrFile(mameInfo);
    return ctrlr.enabled && existsSync(ctrlr.path)
        ? readCtrlrMapDevices(readFileSync(ctrlr.path, 'utf8'))
        : new Map<string, string>();
}

function pinDevice(mameInfo: MameInfo, deviceId: string, joycode: string | null): void {
    const ctrlr = getCtrlrFile(mameInfo);
    const existing = existsSync(ctrlr.path) ? readFileSync(ctrlr.path, 'utf8') : undefined;
    mkdirSync(dirname(ctrlr.path), {recursive: true});
    writeFileSync(ctrlr.path, setCtrlrMapDevice(existing, deviceId, joycode), 'utf8');
    if (!ctrlr.enabled && !setMameIniValue(mameInfo.mameIniPath, 'ctrlr', ctrlr.name)) {
        throw new Error(`"${mameInfo.mameIniPath}" not found.`);
    }
}

/**
 * Boots `romName` headlessly just long enough for device-probe.lua to dump every joystick/gamepad
 * device MAME currently detects and exit the machine, then parses the captured stdout. Which rom is
 * booted doesn't matter (device detection isn't per-game), it's only needed because
 * -autoboot_script requires a running machine. -skip_gameinfo avoids an extra keypress-wait;
 * -video none/-sound none skip creating a window or touching the audio device entirely. timeout
 * is a hard backstop in case a driver never reaches "running" (bad rom, missing BIOS) - the Lua
 * script's own machine:exit() should fire in well under a second normally. killSignal SIGKILL
 * (not the default SIGTERM) because a hung mame process can ignore SIGTERM under some video
 * backends. maxBuffer covers MAME's boot-time stdout chatter.
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
 * Lists whatever joystick/gamepad devices MAME itself currently sees: its "JOY <n>" number, the
 * USB vendor/product IDs when the device id carries them (see GamepadId.ts), and the raw item
 * name=token pairs (e.g. "LT=SLIDER1") it would accept in a default.cfg <newseq>. Each device can
 * be pinned to a fixed JOY number (see MameCtrlr.ts), since MAME otherwise numbers them in
 * detection order, which follows plug/pairing order.
 */
function renderDeviceProbeCard(romNames: string[], pinned: Map<string, string>, state?: DeviceProbeState): string {
    if (!romNames.length) {
        return '';
    }
    const devices = state?.result ?? [];
    const pinnedJoycodeOf = (deviceId: string): string | undefined =>
        Array.from(pinned.entries()).find(([, device]) => device === deviceId)?.[0];
    const joyLabel = (joycode: string) => `JOY ${joycodeNumber(joycode)}`;
    // Enough JOY numbers for every detected device, and at least P1/P2 for a cabinet.
    const joycodes = Array.from({length: Math.max(2, devices.length)}, (_, i) => `JOYCODE_${i + 1}`);

    const cards = devices.map(device => {
        const ids = parseGamepadIds(device.id);
        const pinnedJoycode = pinnedJoycodeOf(device.id);
        // <mapdevice> matches by id: two identical pads can't be told apart.
        const ambiguous = devices.filter(other => other.id === device.id).length > 1;
        const idValues = ids ? `
            <dt>Vendor</dt>
            <dd><code>${escapeHtml(ids.vendorId)}</code>${ids.vendorName ? ` (${escapeHtml(ids.vendorName)})` : ''}</dd>
            <dt>Product</dt>
            <dd><code>${escapeHtml(ids.productId)}</code></dd>
            ${ids.bus ? `<dt>Bus</dt><dd>${escapeHtml(ids.bus)}</dd>` : ''}
        ` : `
            <dt>Vendor</dt>
            <dd class="info">Not reported by this driver</dd>
        `;
        const pinButtons = joycodes.map(joycode => `
            <button type="submit" name="joycode" value="${joycode}"${joycode === pinnedJoycode ? ' disabled' : ''}>${joyLabel(joycode)}</button>
        `).join('');
        return `
            <article class="device">
                <header class="device-header">
                    ${device.joycode ? `<span class="device-joy">${joyLabel(device.joycode)}</span>` : ''}
                    <h3>${escapeHtml(device.name) || 'Unnamed device'}</h3>
                    ${pinnedJoycode ? `<span class="device-pinned" title="Always ${joyLabel(pinnedJoycode)}, whatever the plug order">Pinned</span>` : ''}
                </header>
                <dl class="binding-values">
                    ${idValues}
                    <dt>MAME ID</dt>
                    <dd><code>${escapeHtml(device.id)}</code></dd>
                </dl>
                ${ambiguous ? `
                    <p class="info">Another detected device has the same MAME ID: MAME can't tell them apart,
                    so neither can be pinned (switch one to another mode, e.g. X-input vs. Switch).</p>
                ` : `
                    <form method="post" action="/input-probe/devices/pin" class="binding-actions device-pin">
                        <input type="hidden" name="deviceId" value="${escapeHtml(device.id)}">
                        <span class="device-pin-label">Pin as</span>
                        ${pinButtons}
                        ${pinnedJoycode ? '<button type="submit" name="joycode" value="">Unpin</button>' : ''}
                    </form>
                `}
                <details>
                    <summary>${device.items.length} buttons/axes</summary>
                    <div class="device-items">${device.items.map(item => `<code>${escapeHtml(item)}</code>`).join(' ')}</div>
                </details>
            </article>
        `;
    }).join('');

    // Pins whose device wasn't in this probe (unplugged, or other mode) - only known after a probe.
    const detectedIds = new Set(devices.map(device => device.id));
    const absentPins = state?.result
        ? Array.from(pinned.entries()).filter(([, deviceId]) => !detectedIds.has(deviceId))
        : [];
    const absentList = absentPins.length ? `
        <h3 class="device-absent-title">Pinned, not connected</h3>
        <ul class="device-absent">
            ${absentPins.map(([joycode, deviceId]) => `
                <li>
                    <span class="device-joy">${joyLabel(joycode)}</span>
                    <code>${escapeHtml(deviceId)}</code>
                    <form method="post" action="/input-probe/devices/pin">
                        <input type="hidden" name="deviceId" value="${escapeHtml(deviceId)}">
                        <button type="submit" name="joycode" value="">Unpin</button>
                    </form>
                </li>
            `).join('')}
        </ul>
    ` : '';

    return `
        <section class="card">
            <h2>Detected devices (MAME probe)</h2>
            <p class="info">Runs a rom in the background (no video or sound) just to ask MAME
            which joysticks/gamepads it currently detects, and under which name/token
            (<code>JOYCODE_&lt;n&gt;_&lt;token&gt;</code>) each of their buttons/axes is
            recognized. JOY 1 plays Player 1 and JOY 2 Player 2 by default; MAME numbers devices in
            detection order unless they're pinned.</p>
            ${state?.error ? `<p class="error flash">${escapeHtml(state.error)}</p>` : ''}
            ${state?.info ? `<p class="info flash">${escapeHtml(state.info)}</p>` : ''}
            <form method="post" action="/input-probe/devices">
                <button type="submit">Detect gamepads</button>
            </form>
            ${state?.result ? (cards
                ? `<div class="device-grid">${cards}</div>`
                : '<p class="info flash">No joystick device detected.</p>') : ''}
            ${absentList}
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
    // binds it to them by default - shown so the user knows why e.g. the menu key changed.
    releasedFrom?: string[];
}

interface MameConfigSession {
    child: ChildProcess;
    dir: string;
    nonceCounter: number;
    // The rom MAME was launched with - the per-game remap card is only valid for that one game
    // (its fields dump, game-fields.txt, describes it and nothing else).
    romName: string;
    // Every cfg edit made while this session runs, replayed in order once MAME exits - see
    // applyCfgEdit().
    cfgEdits: (() => void)[];
}

// Module-scope: at most one config session at a time, explicitly started/stopped by a BO user from
// the Gamepads tab (see startMameConfigSession()/stopMameConfigSession()/captureOnePress() below) -
// there's only one cabinet (one MAME window) to configure, so users signed in at the same time
// share it rather than each getting their own.
let mameConfigSession: MameConfigSession | undefined;

function isMameConfigSessionAlive(): boolean {
    return !!mameConfigSession && mameConfigSession.child.exitCode === null && !mameConfigSession.child.killed;
}

/**
 * Runs a cfg edit (default.cfg or cfg/<rom>.cfg) and, while a config session is running, records it
 * so it's replayed once that MAME exits. MAME keeps the input settings it loaded at startup in
 * memory and, on a normal exit (its window's close button, Esc...), rewrites its cfg files from
 * them - silently reverting every edit made in the meantime. Checked against 0.289: a default.cfg
 * edited mid-session was back to its startup content after a normal exit, kept as edited after a
 * SIGKILL. Replaying on exit makes both ways of closing MAME equivalent. Edits are replayed rather
 * than the files restored wholesale, so whatever else MAME saves on exit (mixer, counters, settings
 * changed from its own menus) is kept.
 */
function applyCfgEdit(edit: () => void): void {
    edit();
    if (isMameConfigSessionAlive()) {
        mameConfigSession?.cfgEdits.push(edit);
    }
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
function startMameConfigSession(
    mameBinary: string,
    iniPath: string,
    romName: string,
    // The global remap card doesn't care which game the session runs (default.cfg is global), so
    // it keeps whatever is already running; the per-game card needs that very game, and restarts
    // the session on it if another one is running.
    switchRom = false,
): void {
    if (isMameConfigSessionAlive()) {
        if (!switchRom || mameConfigSession?.romName === romName) {
            return;
        }
        stopMameConfigSession();
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
            // Without it MAME ignores the gamepad while its window isn't the focused one - which is
            // always the case when the BO is driven from a browser on the very same machine (the
            // click on "Capture a press" gives the focus to the browser). Checked with a virtual
            // uinput pad against 0.289: no press seen unfocused without it, captured with it.
            '-background_input',
            '-inipath', iniPath,
            '-homepath', iniPath,
        ],
        {cwd: iniPath, stdio: ['ignore', 'ignore', 'pipe']},
    );
    child.stderr?.on('data', (chunk: Buffer) => {
        console.error('[boServer] mame config session stderr:', chunk.toString('utf8').trim());
    });
    const session: MameConfigSession = {child, dir, nonceCounter: 0, romName, cfgEdits: []};
    child.on('exit', () => {
        if (mameConfigSession === session) {
            mameConfigSession = undefined;
        }
        // MAME has finished writing its own cfg files by now - see applyCfgEdit().
        for (const edit of session.cfgEdits) {
            try {
                edit();
            } catch (error) {
                console.error('[boServer] Failed to replay a cfg edit after MAME exited:', error);
            }
        }
        rmSync(dir, {recursive: true, force: true});
    });

    mameConfigSession = session;
}

function stopMameConfigSession(): void {
    if (isMameConfigSessionAlive()) {
        // SIGKILL, not the default SIGTERM - confirmed by hand that a real windowed MAME process
        // just ignores SIGTERM outright (same "hung mame process can ignore SIGTERM under some
        // video backends" reason runDeviceProbe() already uses it for).
        mameConfigSession?.child.kill('SIGKILL');
    }
}

/**
 * Arms the running config session for one press and blocks - poll/sleep, same spirit as the
 * execFileSync-based probes elsewhere in this file, just spread across a loop instead of one
 * syscall - until it reports a result or CAPTURE_WAIT_MS runs out (generous: the user may need
 * to walk over to the cabinet's pad; the session runs with -background_input, see
 * startMameConfigSession(), so MAME doesn't need the focus). Returns the exact token MAME resolved the press to (e.g. "JOYCODE_1_BUTTON5"), null
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
            applyCfgEdit(() => setDefaultCfgUiInput(cfgPath, otherPort, stripped));
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

/**
 * Rewrites default.cfg's <input> block with exactly `ports` - shared by setDefaultCfgUiInput() and
 * removeDefaultCfgUiInput() below. An empty map drops the block altogether rather than leaving an
 * empty <input></input> behind.
 */
function writeDefaultCfgUiInputs(cfgPath: string, ports: Map<string, string>): void {
    const existing = existsSync(cfgPath) ? readFileSync(cfgPath, 'utf8') : `<?xml version="1.0"?>
<mameconfig version="10">
    <system name="default">
    </system>
</mameconfig>
`;

    // Whole lines only (the block's own indentation and line break): matching from "<input>" to
    // the next non-blank character instead made every rewrite indent the block a bit further.
    const inputBlockMatch = /[ \t]*<input>[\s\S]*?<\/input>[ \t]*\n?/.exec(existing);

    const newInputBlock = !ports.size ? '' : '        <input>\n'
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

function setDefaultCfgUiInput(cfgPath: string, portType: string, token: string): void {
    const ports = readDefaultCfgUiInputs(cfgPath);
    ports.set(portType, token);
    writeDefaultCfgUiInputs(cfgPath, ports);
}

/**
 * Drops `portType`'s override from default.cfg, so MAME falls back to its own default binding for
 * it. A no-op when there's no such override (nothing to rewrite).
 */
function removeDefaultCfgUiInput(cfgPath: string, portType: string): void {
    const ports = readDefaultCfgUiInputs(cfgPath);
    if (ports.delete(portType)) {
        writeDefaultCfgUiInputs(cfgPath, ports);
    }
}

/**
 * Global input remap: "Launch MAME"/"Close MAME" control the shared config session
 * (startMameConfigSession()/stopMameConfigSession() above), and one "Capture a press" form per
 * REMAP_GROUPS action arms it for one press (captureOnePress() above) - the resulting token is
 * written straight into default.cfg's matching <port> entry (setDefaultCfgUiInput() above).
 * "Reset" drops that entry again (removeDefaultCfgUiInput() above).
 * Groups/actions are meant to keep growing in REMAP_GROUPS - this only renders whatever's in it,
 * no other change needed to add more.
 */
function renderRemapCard(romNames: string[], persisted: Map<string, string>, state?: RemapState): string {
    if (!romNames.length) {
        return '';
    }
    const sessionRunning = isMameConfigSessionAlive();
    // Both buttons only make sense with MAME open: a capture needs it to see the press, and a
    // reset is kept consistent with it (the route rejects both while MAME is closed).
    const disabled = sessionRunning ? '' : ' disabled title="Launch MAME first"';
    const renderActionItems = (actions: RemapAction[]): string => actions.map(action => {
        const actionState = state?.portType === action.portType ? state : undefined;
        const currentToken = actionState?.capturedToken ?? persisted.get(action.portType);
        return `
            <div class="binding">
                ${renderBindingLabel(action.portType, action.label)}
                <dl class="binding-values">
                    <dt>Currently</dt>
                    <dd>${currentToken ? `<code>${escapeHtml(currentToken)}</code>` : '<em>MAME default</em>'}</dd>
                </dl>
                <form method="post" action="/input-probe/remap" class="binding-actions">
                    <input type="hidden" name="portType" value="${escapeHtml(action.portType)}">
                    <button type="submit" name="action" value="capture"${disabled}>Capture a press</button>
                    ${persisted.has(action.portType) ? `<button type="submit" name="action" value="reset"${disabled}>Reset</button>` : ''}
                </form>
                ${actionState?.error ? `<p class="error flash">${escapeHtml(actionState.error)}</p>` : ''}
                ${actionState?.releasedFrom?.length ? `
                    <p class="info flash">This button was also bound by default to
                    ${escapeHtml(actionState.releasedFrom.map(port => UI_PORT_LABELS[port] ?? port).join(', '))} in
                    MAME - it was removed from there to avoid a double trigger.</p>
                ` : ''}
            </div>
        `;
    }).join('');

    return `
        <section class="card">
            <h2>Global input configuration</h2>
            <p class="info">Binds a gamepad button to a command. <strong>1.</strong>
            Launch MAME with the button at the top of the page and leave it open
            for the whole configuration - all captures then share the same startup, so the
            same gamepad indexes from start to finish.
            <strong>2.</strong> Click "Capture a press" for the wanted command, then press the
            button on the gamepad within 30 seconds (MAME picks it up even when its window is
            not the one in front). Each press is saved at once to <code>default.cfg</code> (valid
            for all games, unless a specific game has its own override). <strong>3.</strong>
            Close MAME when done, from the top button or from its own window: either way keeps the
            changes. <strong>Currently</strong> reflects what is really saved
            in the file, not just the last capture; <strong>Reset</strong> removes a command from
            the file, so MAME's own default binding applies again. Both buttons stay disabled
            until MAME is launched.</p>
            ${renderPlayerTabs('global', REMAP_GROUPS.map((group, index) => ({
                id: String(index),
                title: group.title,
                html: `<div class="binding-grid">${renderActionItems(group.actions)}</div>`,
            })), state ? String(REMAP_GROUPS.findIndex(group => group.actions.some(action => action.portType === state.portType))) : undefined)}
        </section>
    `;
}

interface PlayerPanel {
    // Short slug, unique within the card - what the tab button and its panel are matched on.
    id: string;
    title: string;
    html: string;
}

/**
 * One tab per player (plus "System"/"Other" where there is one) instead of every player's table
 * stacked one after the other - the Gamepads cards grow long otherwise. Switched client side (see
 * renderPageTail()); `activeId` is the panel to open on, e.g. the one holding the command just
 * captured, so a capture on Player 2 doesn't land back on Player 1.
 */
function renderPlayerTabs(cardId: string, panels: PlayerPanel[], activeId?: string): string {
    return `
        <div class="player-tabs" role="tablist" data-player-tabs="${escapeHtml(cardId)}"
            ${activeId ? `data-active="${escapeHtml(activeId)}"` : ''}>
            ${panels.map(panel => `
                <button type="button" role="tab" data-player-tab="${escapeHtml(panel.id)}">${escapeHtml(panel.title)}</button>
            `).join('')}
        </div>
        ${panels.map(panel => `
            <div class="player-panel" role="tabpanel" data-player-panel="${escapeHtml(`${cardId}:${panel.id}`)}">${panel.html}</div>
        `).join('')}
    `;
}

interface GameRemapState {
    // Which game/field this state is about - like RemapState, only that field's row shows the
    // flash message rather than every row at once.
    romName: string;
    fieldId?: string;
    error?: string;
    capturedToken?: string;
    releasedFrom?: string[];
}

function getGameCfgPath(iniPath: string, romName: string): string {
    return join(iniPath, 'cfg', `${romName}.cfg`);
}

/**
 * The remappable fields of the game the config session is running, as dumped by
 * capture-daemon.lua at startup. undefined while there's no session, or while MAME is still
 * booting and hasn't written the dump yet.
 */
function readSessionGameFields(): GameField[] | undefined {
    if (!isMameConfigSessionAlive() || !mameConfigSession) {
        return undefined;
    }
    const fieldsPath = join(mameConfigSession.dir, 'game-fields.txt');
    return existsSync(fieldsPath)
        ? parseGameFields(readFileSync(fieldsPath, 'utf8')).sort(compareGameFields)
        : undefined;
}

/**
 * Blocks (same poll/sleep spirit as captureOnePress()) until the freshly launched session has
 * dumped its game's fields, so the per-game card lists the commands right away instead of asking
 * the user to reload it. Gives up silently after `timeoutMs`: the card then says MAME is still
 * starting.
 */
function waitForSessionGameFields(timeoutMs: number): void {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline && isMameConfigSessionAlive() && !readSessionGameFields()) {
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 200);
    }
}

function readGameCfgOverrides(cfgPath: string): Map<string, string> {
    return existsSync(cfgPath) ? readGameCfgInputSeqs(readFileSync(cfgPath, 'utf8')) : new Map<string, string>();
}

function setGameCfgOverride(cfgPath: string, romName: string, field: GameField, token: string): void {
    const existing = existsSync(cfgPath) ? readFileSync(cfgPath, 'utf8') : undefined;
    mkdirSync(dirname(cfgPath), {recursive: true});
    writeFileSync(cfgPath, setGameCfgInputSeq(existing, romName, field, token), 'utf8');
}

function removeGameCfgOverride(cfgPath: string, field: GameField): void {
    if (!existsSync(cfgPath)) {
        return;
    }
    const existing = readFileSync(cfgPath, 'utf8');
    const updated = removeGameCfgInputSeq(existing, field);
    if (updated !== existing) {
        writeFileSync(cfgPath, updated, 'utf8');
    }
}

/**
 * Per-game input remap - same flow as the global card above (shared MAME config session,
 * "Capture a press" per command), but written to cfg/<rom>.cfg instead of default.cfg, so it only
 * applies to that game and wins over the global bindings. The commands listed are the ones the
 * game really has (from the running MAME itself, see capture-daemon.lua's game-fields.txt), not a
 * fixed list: a 2-button game shows 2 buttons.
 */
function renderGameRemapCard(
    romNames: string[], romLabels: Map<string, string>, withCfg: Set<string>, iniPath: string, state?: GameRemapState,
): string {
    if (!romNames.length) {
        return '';
    }
    const sessionRunning = isMameConfigSessionAlive();
    const sessionRom = sessionRunning ? mameConfigSession?.romName : undefined;
    const selectedRom = state?.romName ?? sessionRom
        ?? [...romNames].sort((a, b) => (romLabels.get(a) ?? a).localeCompare(romLabels.get(b) ?? b))[0];
    const picker = renderRomPicker('gameRemapRomName', romNames, romLabels, withCfg, selectedRom);

    const renderTable = (romName: string): string => {
        const fields = readSessionGameFields();
        if (!fields) {
            return `<p class="info flash">MAME is still starting <strong>${escapeHtml(romLabels.get(romName) ?? romName)}</strong> -
            click the button above again in a few seconds to show its commands.</p>`;
        }
        if (!fields.length) {
            return '<p class="info flash">This game exposes no remappable command (directions, buttons, coin, start).</p>';
        }
        const overrides = readGameCfgOverrides(getGameCfgPath(iniPath, romName));
        const players = Array.from(new Set(fields.map(field => portTypePlayer(field.portType))));

        const renderItems = (playerFields: GameField[]): string => playerFields.map(field => {
            const id = gameFieldId(field);
            const rowState = state?.fieldId === id ? state : undefined;
            const override = rowState?.capturedToken ?? overrides.get(id);
            return `
                <div class="binding">
                    ${renderBindingLabel(field.portType, field.name || field.portType)}
                    <dl class="binding-values">
                        <dt>MAME default</dt>
                        <dd><code>${escapeHtml(field.defaultSeq)}</code></dd>
                        <dt>This game</dt>
                        <dd>${override ? `<code>${escapeHtml(override)}</code>` : '<em>global</em>'}</dd>
                    </dl>
                    <form method="post" action="/input-probe/game/remap" class="binding-actions">
                        <input type="hidden" name="romName" value="${escapeHtml(romName)}">
                        <input type="hidden" name="fieldId" value="${escapeHtml(id)}">
                        <button type="submit" name="action" value="capture">Capture a press</button>
                        ${overrides.has(id) ? '<button type="submit" name="action" value="reset">Reset</button>' : ''}
                    </form>
                    ${rowState?.error ? `<p class="error flash">${escapeHtml(rowState.error)}</p>` : ''}
                    ${rowState?.releasedFrom?.length ? `
                        <p class="info flash">This button was also bound by default to
                        ${escapeHtml(rowState.releasedFrom.map(port => UI_PORT_LABELS[port] ?? port).join(', '))} in
                        MAME - it was removed from there (globally) to avoid a double trigger.</p>
                    ` : ''}
                </div>
            `;
        }).join('');

        const stateField = fields.find(field => gameFieldId(field) === state?.fieldId);
        return renderPlayerTabs('game', players.map(player => ({
            id: String(player),
            title: player ? `Player ${player}` : 'Other',
            html: `<div class="binding-grid">${renderItems(fields.filter(field => portTypePlayer(field.portType) === player))}</div>`,
        })), stateField ? String(portTypePlayer(stateField.portType)) : undefined);
    };

    return `
        <section class="card">
            <h2>Per-game input configuration</h2>
            <p class="info">Changes which gamepad button does what in <strong>one game only</strong>
            (saved in <code>cfg/&lt;rom&gt;.cfg</code>); every other game keeps the global
            configuration above.</p>
            ${sessionRom && sessionRom === selectedRom ? `
                <ol class="info">
                    <li>Below, each row is a command of this game. <strong>This game</strong> reads
                    <em>global</em> as long as you haven't changed it.</li>
                    <li>Click <strong>Capture a press</strong> on the command to change: the page then
                    waits up to 30 seconds.</li>
                    <li><strong>Press the button</strong> (or push the direction) wanted on the gamepad -
                    MAME picks it up even when its window is not the one in front. The result shows
                    here and is saved at once.</li>
                    <li><strong>Reset</strong> gives a command back its global binding. When you are
                    done, close MAME with the button at the top of the page or from its own window:
                    either way keeps the changes.</li>
                </ol>
            ` : `
                <ol class="info">
                    <li>Search and pick the game below, then click <strong>Launch MAME with this
                    game</strong>: the game opens in a MAME window.</li>
                    <li>Its list of commands appears here, ready to be changed.</li>
                </ol>
            `}
            <form method="post" action="/input-probe/game/start">
                ${picker}
                <button type="submit">${sessionRom === selectedRom ? 'Relaunch MAME with this game' : 'Launch MAME with this game'}</button>
            </form>
            ${sessionRunning ? `
                <p><strong>MAME:</strong> running (${escapeHtml(sessionRom ? (romLabels.get(sessionRom) ?? sessionRom) : '')})</p>
            ` : ''}
            ${state?.error && !state.fieldId ? `<p class="error flash">${escapeHtml(state.error)}</p>` : ''}
            ${sessionRom && sessionRom === selectedRom ? renderTable(sessionRom) : ''}
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
                <button type="submit" class="button-danger">Delete the selection</button>
            </form>
        </section>
    `;
}

function renderForm(
    values: ConfigFormValues,
    mameInfo: MameInfo,
    isAdvanced: boolean,
    error?: string,
    info?: string,
    mameInfoMessage?: string,
    importError?: string,
    dangerZoneInfo?: string,
    deviceProbeState?: DeviceProbeState,
    remapState?: RemapState,
    gameRemapState?: GameRemapState,
): string {
    // Loaded fresh rather than threaded through every renderForm() call site (there are many -
    // see /save, /mame-options/repair-plugins, /reset, etc.) purely for the repo card's
    // credential fields; a sync JSON read is cheap and every route already re-loads Config at
    // least once per request anyway.
    const config = new Config();
    config.load();

    const sections: Subsection[] = [
        // The MAME information (paths resolved from the binary) right under the form that sets it.
        {id: 'config', label: 'Config', html: renderConfigCard(values, mameInfo, error, info)
            + renderMameInfoCard(mameInfo, mameInfoMessage)},
    ];
    // Import and the danger zone both act on paths resolved from the binary's own -showconfig/
    // ui.ini output (rompath, marquees/flyers/logos directories, categorypath...) - until it's
    // configured and validated (mameInfo.error unset), those paths don't exist, so none of these
    // sections have anything meaningful to show or act on.
    if (!mameInfo.error) {
        // Starting packs are MAME-only content (roms/artwork/favorites/categories/player
        // counts, all resolved from this same MAME install) - kept on this tab instead of
        // its own, next to the MAME info it depends on and updates.
        // Always shown, not part of Advanced configuration: gamepad setup is everyday cabinet
        // tuning (the actions spawn MAME on the machine hosting the BO and rewrite default.cfg,
        // game cfgs and the controller file - input bindings only, nothing destructive).
        const romNames = mameInfo.romPath ? listRomNames(mameInfo.romPath) : [];
        const romLabels = config.mamePath && config.mameBinaryName
            ? getRomLabels(join(config.mamePath, config.mameBinaryName), mameInfo.iniPath, romNames)
            : new Map<string, string>();
        const withCfg = listRomsWithInputCfg(mameInfo.iniPath, romNames);
        sections.push({
            id: 'gamepads',
            label: 'Gamepads',
            html: renderRemapCard(
                romNames,
                readDefaultCfgUiInputs(getDefaultCfgPath(mameInfo.iniPath)),
                remapState,
            )
                + renderGameRemapCard(romNames, romLabels, withCfg, mameInfo.iniPath, gameRemapState)
                + renderDeviceProbeCard(romNames, readPinnedDevices(mameInfo), deviceProbeState),
        });
        sections.push({
            id: 'import',
            label: 'Import',
            // renderPythonWarning() is meant to sit right above renderImportCard() (see its own
            // comment) - not a section of its own.
            html: renderPythonWarning() + renderConfPackCard(config, mameInfo) + renderImportCard(importError),
        });
        // Destructive/irreversible - only shown (and only actionable, see /reset) in Advanced configuration.
        if (isAdvanced) {
            sections.push({
                id: 'danger',
                label: 'Danger',
                html: renderMameDangerZoneCard(mameInfo, dangerZoneInfo),
            });
        }
    }
    // Which of the params above is actually filled in tells us which section this specific
    // response is about - e.g. a POST to /reset only ever sets dangerZoneInfo, nothing
    // else, regardless of what other sections might separately have a standing .flash warning
    // of their own (missing plugins, no python3...) that would otherwise wrongly win just for
    // being earlier in `sections` (see renderPageTail()'s script). Most specific first.
    const defaultSubtab = dangerZoneInfo !== undefined ? 'danger'
        : importError !== undefined ? 'import'
            : (deviceProbeState !== undefined || remapState !== undefined
                || gameRemapState !== undefined) ? 'gamepads'
                : (mameInfoMessage !== undefined || error !== undefined || info !== undefined) ? 'config'
                    : undefined;
    // Right of the subtabs (kept in view while scrolling, see .subtabs-bar): the one button that
    // launches/closes the shared MAME config session the Gamepads cards capture through - see
    // startMameConfigSession(). Shown to every signed-in user, like the Gamepads tab itself.
    // data-mame-session lets the page notice MAME being closed from its own window (see
    // renderPageTail()).
    const sessionRunning = isMameConfigSessionAlive();
    const launchButton = `
        <form method="post" action="/input-probe/mame/${sessionRunning ? 'stop' : 'start'}"
            ${sessionRunning ? 'data-mame-session="running"' : ''}>
            <button type="submit" class="launch-button">
                <img src="/mame-logo.svg" alt="" class="launch-logo">
                ${sessionRunning ? 'Close MAME' : 'Launch MAME'}
            </button>
        </form>
    `;
    return renderSubtabbedPage('mame', sections, isAdvanced ? 'advanced' : 'basic', defaultSubtab, launchButton);
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
// viewer, Advanced configuration or not. Cached briefly so repeatedly loading the MAUI tab doesn't burn
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
 * only rendered in Advanced configuration, see renderUpdateCard()). Called by every route that (re-)renders
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
            'Update installed. Use "Restart the application" below (or restart the Pi) '
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

/**
 * `<script>` for a page shown while the process serving it is about to go down and come back
 * (a reset that closes the app, a kiosk session restart): it polls this same BO server until it
 * answers again, then goes to `backHref` - rather than relying on the user to come back on their
 * own once it is up.
 */
function renderRestartWaitScript(backHref: string): string {
    // Only trusts a successful response *after* one has already failed: right after the page
    // loads the old process may still be up for a moment (the exit/restart is delayed so this
    // response can finish flushing), and an immediate success there would just bounce straight
    // back with nothing actually restarted yet.
    return `<script>${
        'var backHref = ' + JSON.stringify(backHref) + ';'
        + 'var sawDown = false;'
        + 'var poll = function () {'
        + 'fetch(backHref, {cache: "no-store", method: "HEAD"}).then(function () {'
        + 'if (sawDown) { window.location.href = backHref; } else { setTimeout(poll, 1000); }'
        + '}).catch(function () { sawDown = true; setTimeout(poll, 1000); });'
        + '};'
        + 'setTimeout(poll, 1000);'
    }</script>`;
}

function renderUpdateReleaseRow(release: UpdateReleaseEntry, capable: boolean, confirmLabel: string): string {
    return `
        <tr>
            <td>${escapeHtml(release.name)}${release.isCurrent ? ' <span class="badge-yes">current version</span>' : ''}</td>
            <td>${escapeHtml(formatPublishedAt(release.publishedAt))}</td>
            <td class="center">
                ${release.assetUrl && !release.isCurrent ? `
                    <form method="post" action="/maui/update/install" data-stream
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
    updateInfo: UpdateInfo, isAdvanced: boolean, installMessage?: string, installError?: string,
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
            ${updateInfo.capable ? `
                <form method="post" action="/maui/update/restart"
                    onsubmit="return confirm('Restart the application now? The screen goes blank for a moment, then it reopens on the version installed in ~/squashfs-root.')">
                    <button type="submit">Restart the application</button>
                </form>
                <p class="info">Relaunches the cabinet session (needed after an installation to run the
                new version). Any game in progress is closed.</p>
            ` : ''}
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
        ${isAdvanced ? `
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

function renderMauiCard(config: Config, isAdvanced: boolean, info?: string): string {
    return `
        <section class="card">
            <h2>mame-awesome-ui</h2>
            ${info ? `<p class="info flash">${escapeHtml(info)}</p>` : ''}
            <form method="post" action="/maui/save">
                <label class="checkbox-row">
                    <input type="checkbox" name="fullscreen" ${config.fullscreen ? 'checked' : ''}>
                    Show fullscreen (unchecked = windowed)
                </label>
                ${isAdvanced ? `
                    <label class="checkbox-row">
                        <input type="checkbox" name="openDevTools" ${config.openDevTools ? 'checked' : ''}>
                        Open DevTools on startup (development mode)
                    </label>
                ` : ''}
                <label class="checkbox-row">
                    <input type="checkbox" name="voteEnabled" ${config.voteEnabled ? 'checked' : ''}>
                    Ask for a vote (thumbs up / neutral / thumbs down) when a game is quit - a neutral vote is asked again next time
                </label>
                <label class="checkbox-row">
                    <input type="checkbox" name="thumbsDownRemovesFavorite" ${config.thumbsDownRemovesFavorite ? 'checked' : ''}>
                    A thumbs down removes the game from the favorites (restorable from the Games tab's removed favorites)
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
    onlineInfo?: string;
    onlineError?: string;
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

// Set once by startBoServer(); read by the MAUI page renderer, which runs outside its closure.
let onlineSession: OnlineSession | null = null;

function renderOnlineSection(messages: MauiPageMessages): string {
    const view = getOnlineView();
    const status = onlineSession?.getStatus();
    const session = view.state === 'configured' && status
        ? {stopped: status.state === 'stopped', status: describeOnlineStatus(status, view.url)}
        : undefined;
    return renderOnlineCard(view, {error: messages.onlineError, info: messages.onlineInfo}, session);
}

function renderMauiPage(
    config: Config, messages: MauiPageMessages = {}, isAdvanced: boolean = false,
    updateInfo?: UpdateInfo,
): string {
    const sections: Subsection[] = [
        {id: 'general', label: 'General', html: renderMauiCard(config, isAdvanced, messages.mauiInfo)},
        {id: 'controls', label: 'Controls', html: renderMauiControlsCard()},
    ];
    if (updateInfo) {
        sections.push({
            id: 'update',
            label: 'Update',
            html: renderUpdateCard(updateInfo, isAdvanced, messages.updateInfoMessage, messages.updateInfoError),
        });
    }
    // Import/export and the danger zone both act on the app's own config/database - only
    // shown (and only actionable, see /maui/export, /maui/import and /reset) in Advanced configuration.
    if (isAdvanced) {
        // Advanced configuration only, see POST /maui/online/*.
        sections.push({
            id: 'online',
            label: 'Online',
            html: renderOnlineSection(messages),
        });
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
        : (messages.onlineError !== undefined || messages.onlineInfo !== undefined) ? 'online'
            : (messages.importExportError !== undefined || messages.importExportInfo !== undefined) ? 'import-export'
                : (messages.updateInfoMessage !== undefined || messages.updateInfoError !== undefined) ? 'update'
                    : messages.mauiInfo !== undefined ? 'general'
                        : undefined;
    return renderSubtabbedPage('maui', sections, isAdvanced ? 'advanced' : 'basic', defaultSubtab);
}

/**
 * Thin wrapper around renderMauiPage() that also computes UpdateInfo (see getUpdateInfo()) -
 * every route that re-renders the MAUI page needs it, same as every /mame-tab route re-resolves
 * MameInfo via getMameInfo(). Centralized here instead of repeated at each of the ~7 call sites.
 */
async function sendMauiPage(
    req: express.Request, res: Response, config: Config, messages: MauiPageMessages = {},
): Promise<void> {
    const isAdvanced = req.session.boAdvanced === true;
    const updateInfo = await getUpdateInfo();
    res.send(renderMauiPage(config, messages, isAdvanced, updateInfo));
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
                <input type="password" id="ssUserPassword" name="ssUserPassword" ${renderSavedPasswordAttributes(values.ssUserPassword)} autocomplete="off">

                <label for="ssSoftName">Software name (softname)</label>
                <input type="text" id="ssSoftName" name="ssSoftName" value="${escapeHtml(values.ssSoftName)}" autocomplete="off">
                <label for="ssDevId">Developer ID (devid) — to be created on screenscraper.fr, the application provides no default value</label>
                <input type="text" id="ssDevId" name="ssDevId" value="${escapeHtml(values.ssDevId)}" autocomplete="off">
                <label for="ssDevPassword">Developer password (devpassword)</label>
                <input type="password" id="ssDevPassword" name="ssDevPassword" ${renderSavedPasswordAttributes(values.ssDevPassword)} autocomplete="off">

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
            <form method="post" action="/favorites/download-media" data-stream>
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
    ], 'advanced', defaultSubtab);
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
 * A missing one is also struck through, so the state doesn't rest on red vs. green alone. A
 * present one carries its image URL (data-preview, served by GET /media/...), shown as a
 * thumbnail following the mouse while hovered (see ASSET_PREVIEW_SCRIPT) - instead of the
 * tooltip, which would cover it.
 */
function renderAssetIcon(kind: 'Marquee' | 'Flyer' | 'Logo', found: boolean, romName: string): string {
    const label = `${kind}: ${found ? 'present' : 'missing'}`;
    const hover = found
        ? `data-preview="/media/${kind.toLowerCase()}/${encodeURIComponent(romName)}.png"`
        : `title="${label}"`;
    return `<span class="asset-icon ${found ? 'badge-yes' : 'badge-no'}" ${hover} role="img" aria-label="${label}">
        <svg ${ICON_SVG_ATTRS}>${ASSET_ICON_PATHS[kind]}${found ? '' : '<path d="M2 14L14 2"/>'}</svg>
    </span>`;
}

function renderAssetIcons(row: FavoriteMediaStatus & {romName: string}): string {
    return `<span class="asset-icons">${renderAssetIcon('Marquee', row.hasMarquee, row.romName)}${
        renderAssetIcon('Flyer', row.hasFlyer, row.romName)}${renderAssetIcon('Logo', row.hasLogo, row.romName)}</span>`;
}

/**
 * Asset thumbnail that follows the mouse over any [data-preview] icon (see renderAssetIcon()):
 * one shared <img>, fixed-positioned next to the cursor and flipped to the other side of it near
 * the viewport's right/bottom edges. pointer-events: none, so it never steals the hover itself.
 */
const ASSET_PREVIEW_SCRIPT = `<img class="asset-preview" id="assetPreview" alt="" hidden>
            <script>(function () {
                var preview = document.getElementById('assetPreview');
                var OFFSET = 16;
                var last = null;
                function place(event) {
                    last = event;
                    var width = preview.offsetWidth;
                    var height = preview.offsetHeight;
                    var x = event.clientX + OFFSET;
                    var y = event.clientY + OFFSET;
                    if (x + width > window.innerWidth) { x = event.clientX - OFFSET - width; }
                    if (y + height > window.innerHeight) { y = event.clientY - OFFSET - height; }
                    preview.style.left = Math.max(0, x) + 'px';
                    preview.style.top = Math.max(0, y) + 'px';
                }
                document.addEventListener('mouseover', function (event) {
                    var icon = event.target.closest && event.target.closest('[data-preview]');
                    if (!icon) { return; }
                    preview.src = icon.dataset.preview;
                    preview.hidden = false;
                    place(event);
                });
                document.addEventListener('mousemove', function (event) {
                    if (!preview.hidden) { place(event); }
                });
                document.addEventListener('mouseout', function (event) {
                    var icon = event.target.closest && event.target.closest('[data-preview]');
                    if (icon && !icon.contains(event.relatedTarget)) {
                        preview.hidden = true;
                        preview.removeAttribute('src');
                    }
                });
                // The image is only sized once loaded: re-place it then, or it would overflow the
                // edge it was meant to flip away from.
                preview.addEventListener('load', function () {
                    if (last && !preview.hidden) { place(last); }
                });
            })();</script>`;

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
const THUMB_UP_ICON_PATHS = '<path d="M5 7v6.5H2.5V7H5z"/>'
    + '<path d="M5 7l2.6-4.5c1.2 0 1.9 1 1.6 2.1L8.8 6.5h3.4c1 0 1.7.9 1.5 1.9l-.9 4c-.2.7-.8 1.1-1.5 1.1H5"/>';
const THUMB_DOWN_ICON_PATHS = `<g transform="rotate(180 8 8)">${THUMB_UP_ICON_PATHS}</g>`;
// Eyes are zero-length round-capped lines: dots that keep the stroke-only look of the other icons.
const NEUTRAL_ICON_PATHS = '<circle cx="8" cy="8" r="6"/><path d="M5.5 10h5"/><path d="M6 6.5v.01M10 6.5v.01"/>';
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

/**
 * Gold cup shown next to a game's name when mhiex can extract its hiscores (the "Hiscores Only"
 * carousel category, see hasHiscoreExtraction()).
 */
const HISCORE_CUP_ICON = `<span class="hiscore-icon" title="Hiscores can be extracted for this game (mhiex)">
        <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
            <path d="M4 2h8v4a4 4 0 0 1-8 0z" fill="currentColor"/>
            <path d="M4 3.5H2.25v1A2.5 2.5 0 0 0 4.5 7M12 3.5h1.75v1A2.5 2.5 0 0 1 11.5 7" fill="none"
                stroke="currentColor" stroke-width="1.25"/>
            <path d="M8 10v2.5M5.5 14h5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
        </svg>
    </span>`;

/** The (i) icon, its text shown as a tooltip on hover. */
function renderInfoIcon(text: string): string {
    return `<span class="info-icon" title="${escapeHtml(text)}">
        <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
            <circle cx="8" cy="8" r="7" fill="none" stroke="currentColor" stroke-width="1.5"/>
            <circle cx="8" cy="4.5" r="1" fill="currentColor"/>
            <rect x="7.25" y="7" width="1.5" height="5" fill="currentColor"/>
        </svg>
    </span>`;
}

/**
 * Category icon ahead of a game's name, the category's name as its tooltip. `undefined` (a list
 * that shows no categories) renders nothing; `null` (a game genre.ini doesn't know) an empty slot
 * of the same width, so the names of a list stay aligned.
 */
function renderGameCategoryIcon(category: GameCategory | null | undefined): string {
    if (category === undefined) {
        return '';
    }
    if (!category) {
        return '<span class="game-category-icon" title="No category"></span>';
    }
    const iconKey = category.iconKey in CATEGORY_ICONS ? category.iconKey : '_default';
    return `<img class="game-category-icon" src="/category-icons/${escapeHtml(iconKey)}.svg"
        title="${escapeHtml(category.name)}" alt="${escapeHtml(category.name)}">`;
}

/**
 * Game name cell content. Pass `romName` to also flag (gold cup) a game whose hiscores can be
 * extracted, and `category` to lead with its category icon (see renderGameCategoryIcon()).
 */
function renderGameName(fullname: string, romName?: string, category?: GameCategory | null): string {
    const {name, extra} = splitGameName(fullname);
    // The name is cut with an ellipsis by CSS (see .game-name-cell) when too long for the column;
    // its title carries the full text. The search matches data-search, not this markup.
    const nameHtml = `<span class="game-name-text" title="${escapeHtml(name)}">${escapeHtml(name)}</span>`;
    const infoIcon = extra ? renderInfoIcon(extra) : '';
    const hiscoreIcon = romName && hasHiscoreExtraction(romName) ? HISCORE_CUP_ICON : '';
    return `<span class="game-name-cell">${renderGameCategoryIcon(category)}${nameHtml}${infoIcon}${hiscoreIcon}</span>`;
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
 * RomName cell content: the romName, followed - same as the name's region/revision info - by an
 * (i) whose tooltip lists its dependencies, instead of a whole column for them. The parent romset
 * (biosName, e.g. "pacman" for a puckman clone) and any device romsets (deviceRoms, e.g. "ym2413")
 * are distinct dependencies a favorite can be missing independently of each other, so both are
 * listed, each on its own line.
 */
function renderRomNameCell(row: FavoriteRow): string {
    const lines = [
        ...(row.cached && row.biosName ? [`Bios: ${row.biosName}`] : []),
        ...(row.cached && row.deviceRoms.length ? [`Devices: ${row.deviceRoms.join(', ')}`] : []),
    ];
    return `<span class="romname-cell"><span class="game-name-text" title="${escapeHtml(row.romName)}">${escapeHtml(row.romName)}</span>${lines.length ? renderInfoIcon(lines.join('\n')) : ''}</span>`;
}

/**
 * What the favorites search matches a row against: the three searchable columns - rom name
 * (romName), name (the full description, including the parenthesized region/revision info that
 * the table only shows as a tooltip) and bios / devices (biosName and deviceRoms, the rom name's
 * own tooltip, see renderRomNameCell()). Not-yet-resolved favorites (no cache entry) only have their romName.
 */
function getFavoriteSearchText(row: FavoriteRow): string {
    if (!row.cached) {
        return row.romName;
    }
    return [row.romName, row.fullname, ...(row.biosName ? [row.biosName] : []), ...row.deviceRoms].join(' ');
}

/**
 * "Update favorites" modal: takes over the form's submit (preventDefault, so neither the page
 * tail's AJAX handler nor a navigation runs), POSTs with Accept: application/x-ndjson and reads
 * the response as a stream (see POST /favorites/refresh), logging each favorite as it is
 * resolved. Closable only once finished, with an explicit end message; closing reloads the page
 * so the list shows the updated names.
 */
const FAVORITES_REFRESH_MODAL = `
            <dialog class="modal" id="favoritesRefreshModal" aria-labelledby="favoritesRefreshTitle">
                <div class="modal-header">
                    <h3 id="favoritesRefreshTitle">Updating favorites</h3>
                    <button type="button" class="modal-close" id="favoritesRefreshClose" aria-label="Close" disabled>×</button>
                </div>
                <progress id="favoritesRefreshProgress" max="1" value="0"></progress>
                <p class="info" id="favoritesRefreshStatus" aria-live="polite">Starting…</p>
                <ul class="progress-log" id="favoritesRefreshLog"></ul>
            </dialog>
            <script>(function () {
                var form = document.getElementById('favoritesRefreshForm');
                var modal = document.getElementById('favoritesRefreshModal');
                var close = document.getElementById('favoritesRefreshClose');
                var progress = document.getElementById('favoritesRefreshProgress');
                var status = document.getElementById('favoritesRefreshStatus');
                var log = document.getElementById('favoritesRefreshLog');
                var running = false;
                var total = 0;

                function finish(message, failed) {
                    running = false;
                    status.textContent = message;
                    status.className = failed ? 'error' : 'info modal-done';
                    close.disabled = false;
                    close.focus();
                }
                function handle(event) {
                    if (event.type === 'start') {
                        total = event.total;
                        progress.max = Math.max(1, total);
                        status.textContent = '0 / ' + total;
                    } else if (event.type === 'row') {
                        var item = document.createElement('li');
                        item.textContent = event.romName + ' : ' + event.fullname;
                        log.appendChild(item);
                        log.scrollTop = log.scrollHeight;
                        progress.value = event.index;
                        status.textContent = event.index + ' / ' + total;
                    } else if (event.type === 'done') {
                        progress.value = progress.max;
                        finish('✓ Update complete: ' + event.total + ' favorite(s) updated. You can close this window.', false);
                    } else if (event.type === 'error') {
                        finish(event.message, true);
                    }
                }

                form.addEventListener('submit', function (event) {
                    event.preventDefault();
                    if (running) { return; }
                    running = true;
                    log.textContent = '';
                    progress.value = 0;
                    status.className = 'info';
                    status.textContent = 'Starting…';
                    close.disabled = true;
                    modal.showModal();
                    fetch(form.action, {method: 'POST', headers: {'Accept': 'application/x-ndjson'}})
                        .then(function (response) {
                            var reader = response.body.getReader();
                            var decoder = new TextDecoder();
                            var buffer = '';
                            function read() {
                                return reader.read().then(function (chunk) {
                                    buffer += decoder.decode(chunk.value || new Uint8Array(), {stream: !chunk.done});
                                    var lines = buffer.split('\\n');
                                    buffer = lines.pop();
                                    lines.filter(Boolean).forEach(function (line) { handle(JSON.parse(line)); });
                                    if (chunk.done) {
                                        if (running) { finish('The update ended without confirmation - check the list.', true); }
                                        return;
                                    }
                                    return read();
                                });
                            }
                            return read();
                        })
                        .catch(function () {
                            finish('Connection lost during the update - it may still have completed, reload to check.', true);
                        });
                });
                // Esc would close the dialog mid-update: only allowed once it is finished.
                modal.addEventListener('cancel', function (event) {
                    if (running) { event.preventDefault(); }
                });
                modal.addEventListener('close', function () { location.reload(); });
                close.addEventListener('click', function () { modal.close(); });
            })();</script>`;

const FAVORITES_PAGE_SIZES = [10, 30, 50, 100];
const FAVORITES_DEFAULT_PAGE_SIZE = 30;

/**
 * The favorites list (searchable, filterable by category, paginated client-side), followed by the
 * removed favorites in a card of their own.
 */
function renderFavoritesCard(favoritesInfo: FavoritesInfo, viewer: Viewer): string {
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

    // favorites.ini keeps mame's own order (new favorites are appended at the end), so the list is
    // sorted here, by name, for both the tab and the "Update favorites" result. A favorite not
    // resolved yet has no name, its romName stands in until the next update.
    const sortedRows = [...favoritesInfo.rows].sort((a, b) => a.fullname.localeCompare(b.fullname));
    // undefined: no category known at all (database unreadable) - no icons, no category filter.
    const categoryOf = (row: FavoriteRow): GameCategory | null | undefined => favoritesInfo.stats
        ? favoritesInfo.stats.get(row.romName)?.category ?? null
        : undefined;
    const rows = sortedRows.map(row => `
        <tr data-search="${escapeHtml(getFavoriteSearchText(row))}" data-category="${escapeHtml(categoryOf(row)?.name ?? '')}">
            <td>${row.cached
                ? renderGameName(row.fullname, row.romName, categoryOf(row))
                : `<em>${escapeHtml(row.romName)}</em>`}</td>
            <td>${renderRomNameCell(row)}</td>
            <td class="center">${renderAssetIcons(row)}</td>
            <td class="center">${favoritesInfo.stats?.get(row.romName)?.playCount || '<em>-</em>'}</td>
            <td class="center">${renderVoteCell(favoritesInfo.stats?.get(row.romName))}</td>
            <td class="center">
                <form method="post" action="/favorites/delete">
                    <input type="hidden" name="romName" value="${escapeHtml(row.romName)}">
                    ${renderIconButton('Remove from favorites', TRASH_ICON_PATHS)}
                </form>
            </td>
        </tr>
    `).join('');

    // Favorites removed from this list (removed-favorites.json), in their own table right after
    // it, newest first. A rom put back by another route (or by mame's own menu) since it was
    // removed isn't "removed" anymore - don't offer to restore what's already there.
    const current = new Set(favoritesInfo.rows.map(row => row.romName));
    const removed = readRemovedFavorites()
        .filter(item => !current.has(item.romName))
        .map(item => ({...item, fullname: item.cache?.fullname ?? item.fullname}))
        .sort((a, b) => b.removedAt.localeCompare(a.removedAt));
    const removedRows = removed.map(item => {
        const row: FavoriteRow = {
            romName: item.romName, fullname: item.fullname, biosName: item.cache?.biosName ?? null,
            deviceRoms: item.cache?.deviceRoms ?? [], cached: !!item.cache,
            hasMarquee: false, hasFlyer: false, hasLogo: false,
        };
        const removedOn = new Date(item.removedAt).toLocaleString('en-GB', {dateStyle: 'short', timeStyle: 'short'});
        return `
        <tr>
            <td>${renderGameName(row.fullname, row.romName, categoryOf(row))}</td>
            <td>${renderRomNameCell(row)}</td>
            <td>${escapeHtml(removedOn)}</td>
            <td class="center">${favoritesInfo.stats?.get(row.romName)?.playCount || '<em>-</em>'}</td>
            <td class="center">${renderVoteCell(favoritesInfo.stats?.get(row.romName))}</td>
            <td class="center">
                <form method="post" action="/favorites/restore">
                    <input type="hidden" name="romName" value="${escapeHtml(row.romName)}">
                    ${renderIconButton('Restore to favorites', RESTORE_ICON_PATHS, 'ok')}
                </form>
            </td>
        </tr>`;
    }).join('');
    const removedCard = `
        <section class="card">
            <h2>Removed favorites (${removed.length})</h2>
            ${removed.length ? `
            <p class="info">"Restore" puts a removed favorite back into <code>favorites.ini</code> in
            alphabetical order, exactly as MAME had written it. Same precaution as for removal: not
            while a MAME game is open.</p>
            <div class="table-wrap">
                <table class="favorites-table fixed-columns">
                    <colgroup>
                        <col>
                        <col class="col-romname">
                        <col class="col-date">
                        <col class="col-plays">
                        <col class="col-vote">
                        <col class="col-action">
                    </colgroup>
                    <thead>
                        <tr>
                            <th>Name</th>
                            <th>RomName</th>
                            <th>Removed on</th>
                            <th class="center" title="Times the game was launched">Plays</th>
                            <th class="center">Vote</th>
                            <th class="center"></th>
                        </tr>
                    </thead>
                    <tbody>${removedRows}</tbody>
                </table>
            </div>` : '<p class="info">No removed favorites.</p>'}
        </section>
    `;

    // Category filter options: every category a favorite is in, with its favorite count, then the
    // favorites genre.ini doesn't know. Their value is data-category above ('' for none).
    const categoryCounts = new Map<string, number>();
    let uncategorizedCount = 0;
    for (const row of sortedRows) {
        const name = categoryOf(row)?.name;
        if (name) {
            categoryCounts.set(name, (categoryCounts.get(name) ?? 0) + 1);
        } else {
            uncategorizedCount++;
        }
    }
    const categoryFilter = favoritesInfo.stats ? `
        <select id="favoritesCategory" aria-label="Filter the favorites by category">
            <option value="*">All categories (${sortedRows.length})</option>
            ${[...categoryCounts].sort(([a], [b]) => a.localeCompare(b)).map(([name, count]) =>
                `<option value="${escapeHtml(name)}">${escapeHtml(name)} (${count})</option>`).join('')}
            ${uncategorizedCount ? `<option value="">No category (${uncategorizedCount})</option>` : ''}
        </select>
    ` : '';

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
                <form method="post" action="/favorites/refresh" data-stream id="favoritesRefreshForm">
                    <button type="submit">Update favorites</button>
                </form>
            </div>
            ${FAVORITES_REFRESH_MODAL}
            <div class="table-search">
                <div class="table-search-controls">
                    <input type="search" id="favoritesSearch" placeholder="Search a name, rom name, bios or device…"
                        autocomplete="off" aria-label="Search the favorites">
                    ${categoryFilter}
                </div>
                <p class="info table-search-count" id="favoritesSearchCount" hidden></p>
            </div>
            <div class="table-wrap">
                <table class="favorites-table fixed-columns" id="favoritesTable">
                    <colgroup>
                        <col>
                        <col class="col-romname">
                        <col class="col-assets">
                        <col class="col-plays">
                        <col class="col-vote">
                        <col class="col-action">
                    </colgroup>
                    <thead>
                        <tr>
                            <th>Name</th>
                            <th>RomName</th>
                            <th class="center" title="Marquee, flyer, logo">Assets</th>
                            <th class="center" title="Times the game was launched">Plays</th>
                            <th class="center">Vote</th>
                            <th class="center"></th>
                        </tr>
                    </thead>
                    <tbody>${rows}</tbody>
                </table>
            </div>
            <div class="table-pager" id="favoritesPager">
                <label for="favoritesPageSize">Per page</label>
                <select id="favoritesPageSize">
                    ${FAVORITES_PAGE_SIZES.map(size => `<option value="${size}"${size === FAVORITES_DEFAULT_PAGE_SIZE ? ' selected' : ''}>${size}</option>`).join('')}
                </select>
                <button type="button" id="favoritesPrevPage" aria-label="Previous page">‹</button>
                <span id="favoritesPageInfo" aria-live="polite"></span>
                <button type="button" id="favoritesNextPage" aria-label="Next page">›</button>
            </div>
            <script>(function () {
                // Search: every term must appear (accents and case ignored) in a row's rom name,
                // name or bios / devices (its data-search, see getFavoriteSearchText()), and the row
                // must be in the chosen category (its data-category; '*' for all). The matches are
                // then paginated. Rows are only hidden, so the remove buttons keep working on what
                // is shown.
                var search = document.getElementById('favoritesSearch');
                var category = document.getElementById('favoritesCategory');
                var count = document.getElementById('favoritesSearchCount');
                var pageSize = document.getElementById('favoritesPageSize');
                var prev = document.getElementById('favoritesPrevPage');
                var next = document.getElementById('favoritesNextPage');
                var pageInfo = document.getElementById('favoritesPageInfo');
                var page = 0;
                // A form posted from the list (vote, remove) re-renders the whole page: its search,
                // category and page are stashed on submit and put back once, on that re-render only.
                var VIEW_KEY = 'bo.favorites.view';
                document.getElementById('favoritesTable').addEventListener('submit', function () {
                    try {
                        sessionStorage.setItem(VIEW_KEY, JSON.stringify({
                            search: search.value, category: category ? category.value : '*', page: page,
                        }));
                    } catch (error) { /* storage blocked: the list just starts over */ }
                });
                // The chosen page size is kept for this browser only (a convenience, not state).
                try {
                    var storedSize = localStorage.getItem('bo.favorites.pageSize');
                    if (storedSize && pageSize.querySelector('option[value="' + storedSize + '"]')) {
                        pageSize.value = storedSize;
                    }
                } catch (error) { /* storage blocked: default page size */ }
                var rows = Array.prototype.slice.call(document.querySelectorAll('#favoritesTable tbody tr'));
                function fold(text) {
                    return text.normalize('NFD').replace(/[\\u0300-\\u036f]/g, '').toLowerCase();
                }
                function render() {
                    var terms = fold(search.value).split(/\\s+/).filter(Boolean);
                    var chosen = category ? category.value : '*';
                    var matches = rows.filter(function (row) {
                        var haystack = fold(row.dataset.search || '');
                        return terms.every(function (term) { return haystack.indexOf(term) >= 0; })
                            && (chosen === '*' || row.dataset.category === chosen);
                    });
                    var size = Number(pageSize.value);
                    var pages = Math.max(1, Math.ceil(matches.length / size));
                    page = Math.min(page, pages - 1);
                    rows.forEach(function (row) { row.hidden = true; });
                    matches.slice(page * size, (page + 1) * size).forEach(function (row) { row.hidden = false; });
                    pageInfo.textContent = 'Page ' + (page + 1) + ' / ' + pages;
                    prev.disabled = page === 0;
                    next.disabled = page >= pages - 1;
                    count.hidden = terms.length === 0 && chosen === '*';
                    count.textContent = matches.length
                        ? matches.length + ' favorite(s) found out of ' + rows.length + '.'
                        : 'No favorite matches this search.';
                }
                // A new search, category or page size starts over from the first page.
                function applySearch() {
                    page = 0;
                    render();
                }
                search.addEventListener('input', applySearch);
                if (category) { category.addEventListener('change', applySearch); }
                pageSize.addEventListener('change', function () {
                    try { localStorage.setItem('bo.favorites.pageSize', pageSize.value); } catch (error) { /* blocked */ }
                    applySearch();
                });
                prev.addEventListener('click', function () { page--; render(); });
                next.addEventListener('click', function () { page++; render(); });
                try {
                    var view = JSON.parse(sessionStorage.getItem(VIEW_KEY) || 'null');
                    sessionStorage.removeItem(VIEW_KEY);
                    if (view) {
                        search.value = view.search || '';
                        if (category && category.querySelector('option[value="' + CSS.escape(view.category) + '"]')) {
                            category.value = view.category;
                        }
                        page = Number(view.page) || 0;
                    }
                } catch (error) { /* storage blocked or unreadable: the list just starts over */ }
                render();
                search.addEventListener('keydown', function (event) {
                    if (event.key === 'Enter') { event.preventDefault(); }
                });
            })();</script>
            <p class="info">Removing a favorite deletes its entry from <code>favorites.ini</code> (the
            roms and artwork stay on disk); it moves to the removed favorites below, from which it
            can be restored. The change shows up on the cabinet the next time MAUI
            starts. Do not do it while a MAME game is open: MAME rewrites this file when it
            closes.</p>
            ${ASSET_PREVIEW_SCRIPT}
            <p class="info">Assets: marquee, flyer and logo, in that order - green when the file is
            present (hover it to preview the image), red (struck through) when it is missing.${viewer === 'advanced'
                ? ' To download the missing artwork from ScreenScraper, use the button in the '
                    + '<a href="/screenscraper">ScreenScraper</a> tab.'
                : ''}</p>
            <p class="info">Vote: the one the players give on the cabinet once a game is quit (thumbs
            up, neutral or thumbs down), changeable here. Whether a thumbs down also removes the
            game from the favorites is set in the <a href="/maui">MAUI</a> tab.</p>
        </section>
        ${removedCard}
    `;
}

interface FavoritesFlash {
    notice?: string;
    warning?: string;
}

const VOTE_LABELS: Record<Vote, string> = {
    [VOTE_UP]: 'Thumbs up',
    [VOTE_NEUTRAL]: 'Neutral',
    [VOTE_DOWN]: 'Thumbs down',
};

const VOTE_ICONS: Record<Vote, {cssClass: string, paths: string}> = {
    [VOTE_UP]: {cssClass: 'up', paths: THUMB_UP_ICON_PATHS},
    [VOTE_NEUTRAL]: {cssClass: 'neutral', paths: NEUTRAL_ICON_PATHS},
    [VOTE_DOWN]: {cssClass: 'down', paths: THUMB_DOWN_ICON_PATHS},
};

/**
 * A game's three vote buttons (thumbs up, neutral, thumbs down), the current one lit up, posting
 * to /votes/set.
 */
function renderVoteForm(romName: string, current: Vote): string {
    const buttons = ([VOTE_UP, VOTE_NEUTRAL, VOTE_DOWN] as const).map(vote => `
        <button type="submit" name="vote" value="${vote}" class="icon-button ${VOTE_ICONS[vote].cssClass}"
            aria-pressed="${current === vote}" title="${VOTE_LABELS[vote]}" aria-label="${VOTE_LABELS[vote]}">
            <svg ${ICON_SVG_ATTRS}>${VOTE_ICONS[vote].paths}</svg>
        </button>
    `).join('');
    return `
        <form method="post" action="/votes/set" class="vote-buttons">
            <input type="hidden" name="romName" value="${escapeHtml(romName)}">
            ${buttons}
        </form>
    `;
}

/**
 * Vote cell of the favorites and removed favorites lists: the vote buttons, or '-' for a game the
 * database doesn't know (or no database at all) - /votes/set would have nothing to update.
 */
function renderVoteCell(stats: GameStats | undefined): string {
    return stats ? renderVoteForm(stats.romName, stats.vote) : '<em>-</em>';
}

// The Home carousel's category icons, embedded as text in this bundle (the BO has no access to
// the renderer's hashed asset files, and src/ is not shipped): keyed by file name without
// extension ("shooter", "_default"...), i.e. by getCategoryIconKey(), the same key the carousel
// derives its CSS class from.
const CATEGORY_ICONS: {[key: string]: string} = Object.fromEntries(
    Object.entries(import.meta.glob('./assets/categories/*.svg', {query: '?raw', import: 'default', eager: true}))
        .map(([path, svg]) => [basename(path, '.svg'), svg as string]),
);

// The Gamepads tab's input icons (see src/assets/input-icons/LICENSE.txt), embedded the same way as
// CATEGORY_ICONS above: keyed by file name without extension, i.e. by inputIconKey().
const INPUT_ICONS: {[key: string]: string} = Object.fromEntries(
    Object.entries(import.meta.glob('./assets/input-icons/*.svg', {query: '?raw', import: 'default', eager: true}))
        .map(([path, svg]) => [basename(path, '.svg'), svg as string]),
);

/** Name of a command in the Gamepads cards, after its icon when it has one (see inputIconKey()). */
function renderBindingLabel(portType: string, label: string): string {
    const iconKey = inputIconKey(portType);
    const icon = iconKey && iconKey in INPUT_ICONS
        ? `<img class="binding-icon" src="/input-icons/${escapeHtml(iconKey)}.svg" alt="">`
        : '';
    return `<div class="binding-label">${icon}${escapeHtml(label)}</div>`;
}

/** Games tab: the favorites, then the removed ones (see renderFavoritesCard()). */
/** What the Games tab's Repository subtab shows (Advanced configuration only, see renderFavoritesPage()). */
interface RepoSection {
    config: Config;
    mameInfo: MameInfo;
    packs?: RepoPack[];
    error?: string;
    info?: string;
}

/**
 * The Games tab: the favorites and, in Advanced configuration, the pack repository the games come
 * from (`repository`), as a second subtab - opened by default when a repository action set its
 * packs or a message.
 */
function renderFavoritesPage(favoritesInfo: FavoritesInfo, viewer: Viewer, repository?: RepoSection): string {
    const favoritesHtml = renderFavoritesCard(favoritesInfo, viewer);
    if (!repository) {
        return renderPage(favoritesHtml, 'favorites', viewer);
    }
    const {config, mameInfo, packs, error, info} = repository;
    // The repository's imports resolve every path from the MAME binary: nothing to act on until
    // it is configured (same gating as the MAME tab's Import section).
    const repositoryHtml = mameInfo.error
        ? `<section class="card"><h2>Starting pack repository</h2>
            <p class="error">${escapeHtml(mameInfo.error)}</p></section>`
        : renderRepoImportCard(config, mameInfo, packs, error, info);
    return renderSubtabbedPage('favorites', [
        {id: 'favorites', label: 'Favorites', html: favoritesHtml},
        {id: 'repository', label: 'Repository', html: repositoryHtml},
    ], viewer, packs !== undefined || error !== undefined || info !== undefined ? 'repository' : undefined);
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
            <form method="post" action="/import" enctype="multipart/form-data" data-stream>
                <label for="pack">ZIP file</label>
                <input type="file" id="pack" name="pack" accept=".zip" required>
                <button type="submit">Import</button>
            </form>
        </section>
    `;
}

/**
 * The configuration pack (see ConfPack.ts): the category files the carousel needs, downloaded
 * from the pack repository. Shown outside Advanced configuration too - without it the carousel
 * has no genres - but installing it needs the repository configured (Advanced configuration,
 * Games > Repository); it can also be imported by hand with the form below it, being a plain `folders/`
 * ZIP.
 */
function renderConfPackCard(config: Config, mameInfo: MameInfo): string {
    const missing = getMissingConfPackFiles(mameInfo);
    const status = missing.length
        ? `<p class="error">${renderFoundIcon(false)}Missing: ${missing.map(escapeHtml).join(', ')} - the game
            packs of the repository stay locked until it is installed.</p>`
        : `<p class="info">${renderFoundIcon(true)}Installed (catver.ini, genre.ini, Multiplayer.ini).</p>`;
    const action = config.repoUrl
        ? `<form method="post" action="/import/conf-pack" data-stream>
                <button type="submit">${missing.length ? 'Install' : 'Update'} the configuration pack</button>
            </form>`
        : `<p class="info"><em>Set the repository (Advanced configuration, Games > Repository) to download it, or import
            ${escapeHtml(CONF_PACK_FILENAME)} with the form below.</em></p>`;
    return `
        <section class="card">
            <h2>Configuration pack</h2>
            <p class="info">Genres (catver.ini, genre.ini) and player counts (Multiplayer.ini) the carousel is
            built from. Required: it is also reinstalled before every game pack import from the repository.</p>
            ${status}
            ${action}
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
 * `<pack>.manifest.json` next to a pack's zip on the repository:
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
        const hasHi = hasHiscoreExtraction(game.romName);
        const label = `${escapeHtml(decodeXmlEntities(game.fullname))}${hasHi
            ? ' <span class="hi-badge" title="Hiscores can be extracted for this game (mhiex)">HI</span>' : ''}
            ${meta ? `<span class="checkbox-row-detail">${meta}</span>` : ''}`;
        const classes = `pack-game pack-game-${game.status}${game.status === 'new' && isUpdate ? ' pack-game-highlight' : ''}`;
        // What the search box looks in (folded and matched in the page, see renderRepoPackPicker()).
        const search = escapeHtml([
            decodeXmlEntities(game.fullname), game.romName, game.manufacturer && decodeXmlEntities(game.manufacturer),
            game.categoryName, game.year,
        ].filter(Boolean).join(' '));
        if (game.status === 'installed' || fullyOwned) {
            return `
                <li class="${classes}" data-search="${search}" data-hi="${hasHi ? '1' : '0'}">
                    <span class="pack-game-mark" title="${title}">${mark}</span>
                    <span>${label}</span>
                </li>
            `;
        }
        return `
            <li class="${classes}" data-search="${search}" data-hi="${hasHi ? '1' : '0'}">
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
            <label class="checkbox-row">
                <input type="checkbox" id="packHiOnly">
                <span>Only games with hiscores extraction (<span class="hi-badge">HI</span>)</span>
            </label>
            <p class="info pack-search-count" id="packSearchCount" hidden></p>
        </div>
        <form method="post" action="/import/from-url" data-stream
            onsubmit="return confirm('This overwrites the roms and media of the selected games, then adds them to your MAME favorites without touching yours. Only these games are fetched from their pack. Continue?')">
            <p class="info">Tick a pack for all its games not installed yet, or open it to pick games one by one.
            A game listed by several packs is fetched once. While a search or the hiscores filter is active,
            the pack boxes and "Select all" only act on the games shown; ticked games stay ticked when they are hidden.</p>
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
            var hiOnly = document.getElementById('packHiOnly');
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
            // name, studio, category or year, or in its pack's name; with the hiscores box ticked
            // the game must also have an extractor (data-hi). A pack with no match is hidden,
            // one with matches opens on them; clearing both puts the packs back as they were.
            function fold(text) {
                return text.normalize('NFD').replace(/[\\u0300-\\u036f]/g, '').toLowerCase();
            }
            var openBeforeSearch = null;
            function applySearch() {
                var terms = fold(search.value).split(/\\s+/).filter(Boolean);
                var searching = terms.length > 0 || hiOnly.checked;
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
                        var match = terms.every(function (term) { return haystack.indexOf(term) >= 0; })
                            && (!hiOnly.checked || item.dataset.hi === '1');
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
                    : 'No game matches.';
                refresh();
            }
            search.addEventListener('input', applySearch);
            hiOnly.addEventListener('change', applySearch);
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
 * been fetched, the picker itself. Advanced configuration only, same gating as renderMameDangerZoneCard() (see
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
            HTTP repository, without going through the upload
            (MAME > Import tab) - useful for a pack too large for a browser form.</p>
            ${error ? `<p class="error flash">${escapeHtml(error)}</p>` : ''}
            ${info ? `<p class="info flash">${escapeHtml(info)}</p>` : ''}
            <form method="post" action="/repo/save" novalidate>
                <label for="repoUrl">Repository URL</label>
                <input type="text" id="repoUrl" name="repoUrl" value="${escapeHtml(config.repoUrl)}"
                    placeholder="https://repo.maui.domaine.com" autocomplete="off">
                <label for="repoUser">Username</label>
                <input type="text" id="repoUser" name="repoUser" value="${escapeHtml(config.repoUser)}" autocomplete="off">
                <label for="repoPassword">Password</label>
                <input type="password" id="repoPassword" name="repoPassword" ${renderSavedPasswordAttributes(config.repoPassword)} autocomplete="off">
                <button type="submit">Save</button>
            </form>
            ${config.repoUrl ? `
                ${renderDiskSpaceInfo(mameInfo)}
                ${getMissingConfPackFiles(mameInfo).length
                    ? '<p class="info"><em>Install the configuration pack first (MAME > Import tab) to browse the game packs.</em></p>'
                    : `<form method="get" action="/import/from-url/packs">
                        <button type="submit">Browse available packs</button>
                    </form>
                    ${packs ? renderRepoPackPicker(packs) : ''}`}
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

interface UsersListExtras {
    isAdvanced: boolean;
    deleted: DeletedUserRow[];
}

/**
 * Every player in one table: the active/inactive ones first, then - in Advanced configuration only,
 * who alone can restore or purge them - the deleted ones, dimmed, with their restore/purge
 * actions in place of the usual ones. A deleted player is only soft-deleted: the nickname stays
 * reserved and their scores stay in the database (hidden from the hiscore views), so restoring
 * brings all of it back.
 */
function renderUsersListCard(
    users: User[], avatarFilenames: string[], error?: string, info?: string,
    extras: UsersListExtras = {isAdvanced: false, deleted: []},
): string {
    const avatarsPath = new Config().avatarsPath;
    const rows = users.map(user => {
        const avatarFilename = findAvatarFile(avatarFilenames, user.pseudo_3);
        const hasAvatar = avatarFilename !== undefined;
        return `
        <tr>
            <td class="center">
                <form method="post" action="/users/${user.id_user}/avatar" enctype="multipart/form-data">
                    <label class="avatar-upload" title="Change the avatar (PNG)">
                        ${hasAvatar
                            ? `<img class="avatar-thumb" src="/avatars/${encodeURIComponent(avatarFilename as string)}${avatarCacheBust(avatarsPath, avatarFilename as string)}" alt="">`
                            : '<span class="avatar-thumb avatar-placeholder">＋</span>'}
                        <!-- requestSubmit(), not submit(): the latter bypasses the 'submit' event
                        entirely (a DOM quirk), which would skip the AJAX interception below and
                        leave the browser stuck on this POST's own URL (see renderPageTail()). -->
                        <input type="file" name="avatar" accept="image/png" onchange="this.form.requestSubmit()">
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
                        onsubmit="return confirm('Delete ${escapeHtml(user.pseudo_3)}? The nickname stays reserved; the player can be restored later in Advanced configuration.')">
                        ${renderIconButton('Delete player', TRASH_ICON_PATHS)}
                    </form>
                </div>
            </td>
        </tr>
    `;
    }).join('');

    const deleted = extras.isAdvanced ? extras.deleted : [];
    const deletedRows = deleted.map(({user, scoreCount}) => {
        const avatarFilename = findAvatarFile(avatarFilenames, user.pseudo_3);
        const deletedOn = new Date(user.deletionDate).toLocaleString('en-GB', {
            dateStyle: 'short', timeStyle: 'short',
        });
        return `
        <tr class="row-deleted">
            <td class="center">${avatarFilename !== undefined
                ? `<img class="avatar-thumb" src="/avatars/${encodeURIComponent(avatarFilename)}${avatarCacheBust(avatarsPath, avatarFilename)}" alt="">`
                : '<span class="avatar-thumb avatar-placeholder">-</span>'}</td>
            <td>${escapeHtml(user.pseudo_3)}</td>
            <td>${user.realname ? escapeHtml(user.realname) : '<em>-</em>'}</td>
            <td class="center"><span class="badge-deleted" title="Deleted on ${escapeHtml(deletedOn)}, ${scoreCount} score(s) kept">🗑 deleted ${escapeHtml(deletedOn)} · ${scoreCount} score(s)</span></td>
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
            <h2>Players (${users.length}${deleted.length ? ` + ${deleted.length} deleted` : ''})</h2>
            ${error ? `<p class="error flash">${escapeHtml(error)}</p>` : ''}
            ${info ? `<p class="info flash">${escapeHtml(info)}</p>` : ''}
            ${deleted.length ? `<p class="info">A deleted player's nickname stays reserved: nobody can
            register it, so nobody inherits their scores. Restoring brings the player back with their
            scores and avatar; only restore a player for the person who owns the nickname. Deleting
            permanently removes the player, their scores and their avatar from the database for good,
            and frees the nickname.</p>` : ''}
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
                    <tbody>${rows + deletedRows || '<tr><td colspan="5"><em>No players</em></td></tr>'}</tbody>
                </table>
            </div>
        </section>
    `;
}

function renderUsersPage(
    users: User[], avatarFilenames: string[], error?: string, info?: string, createError?: string,
    extras: UsersListExtras = {isAdvanced: false, deleted: []},
): string {
    // One page, no subtabs: the add form, then every player (deleted ones included, see
    // renderUsersListCard()) in a single list.
    return renderPage(
        renderCreateUserCard(createError) + renderUsersListCard(users, avatarFilenames, error, info, extras),
        'users',
        extras.isAdvanced ? 'advanced' : 'basic',
    );
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

/**
 * `carried`: both Config fields as they were in the form when Browse was clicked, carried along
 * every link here so that choosing (or cancelling) one of them brings the page back with the other
 * one still filled in - it may not be saved yet (e.g. a first setup: binary folder picked, then the
 * plugins folder).
 */
function renderBrowsePage(
    target: PathField, currentDir: string, carried: Record<PathField, string>, viewer: Viewer,
): string {
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
    // Empty fields are left out rather than carried as empty params: the page this returns to
    // treats a present-but-empty query param differently from an absent one (falls back to the
    // saved config/mame.ini value only when the param is absent).
    const query = (values: Record<PathField, string>) => (Object.keys(values) as PathField[])
        .filter(field => values[field])
        .map(field => `${field}=${encodeURIComponent(values[field])}`)
        .join('&');
    const carryQuery = query(carried);
    const navLink = (dir: string) => `/browse?target=${target}&path=${encodeURIComponent(dir)}${carryQuery ? `&${carryQuery}` : ''}`;
    const selectLink = (dir: string) => `/?${query({...carried, [target]: dir})}`;

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
    `, 'mame', viewer);
}

/**
 * Starts the BO. `databaseReady` resolves once the database exists and is migrated (see
 * bootstrapDatabase()); requests arriving before wait for it.
 */
/**
 * Guard of the /maui/online/* routes, which decide where the ONLINE token is sent: Advanced
 * configuration only, and same-origin only since the BO has no CSRF token (see SameOrigin.ts and
 * docs/DECISIONS.md). Sends the 403 itself; true means the caller must stop.
 */
function refuseOnlineRequest(req: Request, res: Response): boolean {
    if (!req.session.boAdvanced) {
        res.status(403).send('Available in Advanced configuration only.');
        return true;
    }
    if (!isSameOriginRequest({origin: req.get('origin'), referer: req.get('referer'), host: req.get('host')})) {
        res.status(403).send('Cross-site request refused.');
        return true;
    }
    return false;
}

export function startBoServer(
    port: number, reloadFront: () => void, onReset: () => void,
): {server: Server; databaseReady: Promise<void>; online: OnlineSession} {
    // Created here so the Online routes can restart it; started and stopped by background.ts.
    const online = new OnlineSession({
        mauiVersion: getRunningVersion(),
        readMameVersion: () => {
            const config = new Config();
            config.load();
            return readMameVersion(config.mamePath && config.mameBinaryName
                ? join(config.mamePath, config.mameBinaryName)
                : '');
        },
    });
    onlineSession = online;
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
    const PUBLIC_PATHS = new Set(['/login', '/background.jpg', '/mame-logo.svg', '/maui-logo.png']);
    app.use((req, res, next) => {
        if (PUBLIC_PATHS.has(req.path) || req.session.boUserId) {
            next();
            return;
        }
        res.redirect('/login');
    });
    const DEFAULT_PASSWORD_PATHS = new Set(['/account', '/account/password', '/logout']);
    app.use((req, res, next) => {
        if (!req.session.mustChangePassword || PUBLIC_PATHS.has(req.path) || DEFAULT_PASSWORD_PATHS.has(req.path)) {
            next();
            return;
        }
        res.redirect('/account');
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
    const sequelize = createSequelize();
    const databaseReady = bootstrapDatabase(sequelize);
    // Every route below reads the database sooner or later (the login page first): hold requests
    // until it exists, instead of failing on a missing table for the first second of a first launch.
    app.use((req, res, next) => {
        databaseReady.then(() => next());
    });

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

    app.get('/input-icons/:key.svg', (req, res) => {
        const svg = INPUT_ICONS[req.params.key];
        if (!svg) {
            res.sendStatus(404);
            return;
        }
        res.type('image/svg+xml').set('Cache-Control', 'public, max-age=3600').send(svg);
    });

    app.get('/maui-logo.png', (req, res) => {
        res.sendFile('img/maui-logo.png', {root: getStaticPath()});
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
            // The database bootstrap failed (see bootstrapDatabase(), logged at startup).
            res.status(503).send(renderLoginPage(
                'The database could not be initialized - restart the application, then retry.',
            ));
            return;
        }
        if (!boUser || !bcrypt.compareSync(password, boUser.passwordHash)) {
            res.status(401).send(renderLoginPage('Incorrect username or password.'));
            return;
        }
        req.session.boUserId = boUser.id;
        req.session.boUsername = boUser.username;
        req.session.boAdvanced = false;
        if (password === DEFAULT_BO_PASSWORD) {
            // Never unlock (hence never encrypt) the credentials with a public password.
            req.session.mustChangePassword = true;
            res.redirect('/account');
            return;
        }
        await unlockSecrets(req, boUser, password);
        res.redirect('/');
    });

    // Flips Advanced configuration for this session and goes back to the page it was toggled from
    // (an advanced-only page such as /screenscraper then redirects basic viewers to / by itself).
    app.post('/advanced', (req, res) => {
        req.session.boAdvanced = !req.session.boAdvanced;
        let back = '/';
        try {
            const referer = new URL(req.get('referer') || '', `http://${req.get('host')}`);
            // Same-origin paths only - never an open redirect.
            if (referer.host === req.get('host') && !referer.pathname.startsWith('//')) {
                back = referer.pathname + referer.search;
            }
        } catch {
            // Missing/malformed Referer: back to /.
        }
        res.redirect(back);
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
        res.send(renderAccountPage(boUser.username, getViewer(req), req.session.mustChangePassword === true));
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
        const mustChange = req.session.mustChangePassword === true;
        const sendError = (status: number, error: string) => {
            res.status(status).send(renderAccountPage(boUser.username, getViewer(req), mustChange, error));
        };

        if (!bcrypt.compareSync(currentPassword, boUser.passwordHash)) {
            sendError(401, 'Incorrect current password.');
            return;
        }
        if (newPassword.length < MIN_BO_PASSWORD_LENGTH) {
            sendError(422, `The new password must be at least ${MIN_BO_PASSWORD_LENGTH} characters long.`);
            return;
        }
        if (newPassword === DEFAULT_BO_PASSWORD) {
            sendError(422, 'Choose a password other than the default one.');
            return;
        }
        if (newPassword !== confirmPassword) {
            sendError(422, 'The confirmation does not match the new password.');
            return;
        }

        // Same data key, re-wrapped with the new password: the config file stays as it is. Not
        // unlocked yet when signed in with the default password - unlocked here instead.
        const dataKey = getSecretsKey(req)
            ?? (boUser.secretsKey ? unwrapDataKey(currentPassword, boUser.secretsKey) : null)
            ?? generateDataKey();
        boUser.passwordHash = bcrypt.hashSync(newPassword, 10);
        boUser.secretsKey = wrapDataKey(newPassword, dataKey);
        await boUser.save();
        req.session.mustChangePassword = false;
        await unlockSecrets(req, boUser, newPassword);
        res.send(renderAccountPage(boUser.username, getViewer(req), false, undefined, 'Password updated.'));
    });

    app.get('/', (req, res) => {
        const config = new Config();
        config.load();
        const mamePath = typeof req.query.mamePath === 'string' ? req.query.mamePath : (config.mamePath || '');
        const mameInfo = getMameInfo(config);
        // Only set after browsing for the plugins folder (Config card) - not persisted until that
        // form is saved, same as mamePath above.
        if (typeof req.query.pluginsPath === 'string') {
            mameInfo.pluginsPath = req.query.pluginsPath;
        }
        res.send(renderForm(
            {mamePath}, mameInfo, req.session.boAdvanced === true,
        ));
    });

    // The whole ScreenScraper tab is Advanced configuration only (its link is left out of the basic nav, see
    // renderPageHead()): the credentials it holds, and the media download it runs.
    app.get('/screenscraper', (req, res) => {
        if (!req.session.boAdvanced) {
            res.redirect('/');
            return;
        }
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
     * re-renders after POST /favorites/delete, /favorites/restore and /votes/set, `flash` being
     * that action's message.
     */
    const renderFavoritesTab = async (
        req: Request, flash: FavoritesFlash = {}, repository: Omit<RepoSection, 'config' | 'mameInfo'> = {},
    ): Promise<string> => {
        const config = new Config();
        config.load();
        const context = getFavoritesContext(config);
        // Repository subtab: Advanced configuration only, like the routes below it.
        const repositorySection = req.session.boAdvanced
            ? {config, mameInfo: getMameInfo(config), ...repository}
            : undefined;

        if ('error' in context) {
            return renderFavoritesPage({rows: [], error: context.error, ...flash}, getViewer(req), repositorySection);
        }

        // Reads names/BIOS from the favorites cache instead of resolving them live (each favorite
        // otherwise costs a blocking `mame -lx` process spawn - see resolveFavoriteRow()), so this
        // tab loads instantly regardless of favorites count. Media badges stay live either way
        // (getFavoriteMediaStatus() is a cheap fs check). See POST /favorites/refresh below for
        // the button that re-resolves everything and rewrites the cache.
        const cache = readFavoritesCache();
        const rows = context.romNames.map(romName => favoriteRowFromCache(context, romName, cache));
        return renderFavoritesPage(
            {rows, cacheUpdatedAt: cache?.updatedAt ?? null, stats: await loadGameStats() ?? undefined, ...flash},
            getViewer(req),
            repositorySection,
        );
    };

    app.get('/favorites', async (req, res) => {
        res.send(await renderFavoritesTab(req));
    });

    app.post('/favorites/delete', async (req, res) => {
        const romName: string = (req.body.romName || '').trim();
        // Same character set as parseFavorites()/getFavoriteRomNames(): anything else can't be
        // a favorite this tab lists.
        if (!/^[a-z0-9]+$/.test(romName)) {
            res.status(422).send(await renderFavoritesTab(req, {warning: 'Invalid rom name.'}));
            return;
        }
        if (isMameConfigSessionAlive()) {
            res.status(409).send(await renderFavoritesTab(req, {
                warning: 'MAME is open (Gamepads tab): close it first, it would rewrite favorites.ini.',
            }));
            return;
        }

        const {favoritesPath} = getMameLocations(getMameHomePath());
        if (!favoritesPath) {
            res.status(404).send(await renderFavoritesTab(req, {warning: 'No favorites.ini file found.'}));
            return;
        }

        if (removeFavoriteFromDisk(favoritesPath, romName) === null) {
            res.status(422).send(await renderFavoritesTab(req, {
                warning: `Unable to remove "${romName}": entry not found or unexpected favorites.ini format.`,
            }));
            return;
        }

        res.send(await renderFavoritesTab(req, {
            notice: `"${romName}" removed from the favorites (it can be restored from the removed favorites below).`,
        }));
    });

    app.post('/favorites/restore', async (req, res) => {
        const romName: string = (req.body.romName || '').trim();
        const removed = readRemovedFavorites();
        const item = removed.find(candidate => candidate.romName === romName);
        if (!item) {
            res.status(404).send(await renderFavoritesTab(req, {warning: `"${romName}" is not in the removed favorites.`}));
            return;
        }
        if (isMameConfigSessionAlive()) {
            res.status(409).send(await renderFavoritesTab(req, {
                warning: 'MAME is open (Gamepads tab): close it first, it would rewrite favorites.ini.',
            }));
            return;
        }

        const {favoritesPath} = getMameLocations(getMameHomePath());
        if (!favoritesPath) {
            res.status(404).send(await renderFavoritesTab(req, {warning: 'No favorites.ini file found.'}));
            return;
        }

        const updated = addFavorite(readFileSync(favoritesPath, 'utf8'), item.entry);
        // null = already listed (put back by mame's own menu in the meantime) or a corrupt saved
        // entry - tell the two apart so the message is accurate.
        if (updated === null && !getFavoriteRomNames(favoritesPath).includes(romName)) {
            res.status(422).send(await renderFavoritesTab(req, {
                warning: `Unable to restore "${romName}": the saved entry is invalid.`,
            }));
            return;
        }
        if (updated !== null) {
            writeFileSync(favoritesPath, updated, 'utf8');
        }

        // Written after favorites.ini for the reverse reason of /favorites/delete: a failure here
        // leaves the favorite restored (and merely still listed as removed until this rom is seen
        // in favorites.ini - the favorites list hides it), never a favorite lost.
        writeRemovedFavorites(removed.filter(candidate => candidate.romName !== romName));
        if (item.cache) {
            const cache = readFavoritesCache();
            if (cache) {
                cache.entries[romName] = item.cache;
                writeFileSync(getFavoritesCachePath(), JSON.stringify(cache));
            }
        }

        res.send(await renderFavoritesTab(req, {
            notice: updated === null
                ? `"${romName}" was already in the favorites.`
                : `"${romName}" restored to the favorites.`,
        }));
    });

    app.post('/votes/set', async (req, res) => {
        const romName: string = (req.body.romName || '').trim();
        const vote = parseVote(req.body.vote);
        if (!/^[a-z0-9]+$/.test(romName) || vote === null) {
            res.status(422).send(await renderFavoritesTab(req, {warning: 'Invalid vote.'}));
            return;
        }

        let updated: number;
        try {
            // paranoid: false - a game already out of the favorites keeps its vote editable.
            [updated] = await Game.update({vote}, {where: {romName}, paranoid: false});
        } catch {
            res.status(503).send(await renderFavoritesTab(req, {
                warning: 'Database not ready yet - launch the application once, then retry.',
            }));
            return;
        }
        if (!updated) {
            res.status(404).send(await renderFavoritesTab(req, {warning: `Unknown game "${romName}".`}));
            return;
        }

        const flash: FavoritesFlash = {notice: `Vote saved for "${romName}": ${VOTE_LABELS[vote].toLowerCase()}.`};
        const config = new Config();
        config.load();
        const {favoritesPath} = getMameLocations(getMameHomePath());
        if (vote === VOTE_DOWN && config.thumbsDownRemovesFavorite && favoritesPath
            && getFavoriteRomNames(favoritesPath).includes(romName)) {
            if (isMameConfigSessionAlive()) {
                flash.warning = 'MAME is open (Gamepads tab): close it first, it would rewrite favorites.ini. '
                    + 'The game stays in the favorites for now.';
            } else if (removeFavoriteFromDisk(favoritesPath, romName)) {
                flash.notice += ' Removed from the favorites (restorable from the removed favorites, below the favorites list).'
                    + ' The change shows up on the cabinet the next time MAUI starts.';
            } else {
                flash.warning = 'Unable to remove the game from favorites.ini: entry not found or unexpected format.';
            }
        }
        res.send(await renderFavoritesTab(req, flash));
    });

    app.post('/favorites/refresh', async (req, res) => {
        const config = new Config();
        config.load();
        const context = getFavoritesContext(config);

        // The favorites list's update modal (see FAVORITES_REFRESH_MODAL) asks for its progress as
        // newline-delimited JSON events instead of a page: start (total), row (each favorite as it
        // is resolved), then done or error. The HTML stream below is the no-JS fallback.
        if (req.get('Accept') === 'application/x-ndjson') {
            res.writeHead(200, {'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-cache'});
            res.socket?.setNoDelay(true);
            const send = (event: object) => res.write(JSON.stringify(event) + '\n');
            if ('error' in context) {
                send({type: 'error', message: context.error});
                res.end();
                return;
            }
            send({type: 'start', total: context.romNames.length});
            try {
                const {rows} = resolveFavorites(context, (row, index) => {
                    send({type: 'row', index: index + 1, romName: row.romName, fullname: row.fullname});
                });
                send({type: 'done', total: rows.length});
            } catch (error) {
                send({type: 'error', message: `Update interrupted: ${error instanceof Error ? error.message : String(error)}`});
            }
            res.end();
            return;
        }

        if ('error' in context) {
            res.send(renderFavoritesPage({rows: [], error: context.error}, getViewer(req)));
            return;
        }

        res.writeHead(200, {'Content-Type': 'text/html; charset=utf-8'});
        res.socket?.setNoDelay(true);
        res.write(renderPageHead('favorites', getViewer(req)));
        const {rows, cache} = streamFavoritesRefresh(res, context);
        res.write(renderFavoritesCard({
            rows, cacheUpdatedAt: cache.updatedAt, stats: await loadGameStats() ?? undefined,
        }, getViewer(req)));
        res.write(renderPageTail());
        res.end();
    });

    /**
     * Renders the Players tab. The deleted players (Advanced configuration only) are loaded here, on
     * every render, so each route below keeps showing up-to-date deleted players without
     * having to pass it along.
     */
    const usersPage = async (
        req: Request, users: User[], avatarFilenames: string[], error?: string, info?: string,
        createError?: string,
    ): Promise<string> => {
        const isAdvanced = req.session.boAdvanced === true;
        const deleted = isAdvanced ? await listDeletedUsers().catch(() => []) : [];
        return renderUsersPage(users, avatarFilenames, error, info, createError, {isAdvanced, deleted});
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
                    `The nickname "${pseudo3}" belongs to a deleted player and is reserved. That player `
                    + 'can be restored from the players list in Advanced configuration.',
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
            // hidden from the hiscore views, until the player is restored (Advanced configuration).
            await user.destroy();
        }
        const users = await User.findAll({order: [['pseudo_3', 'ASC']]});
        res.send(await usersPage(
            req, users, getAvatarFilenames(new Config()), undefined,
            user ? `Player "${user.pseudo_3}" deleted. The nickname stays reserved; it can be `
                + 'restored from the players list in Advanced configuration.' : undefined,
        ));
    });

    app.post('/users/:id/purge', async (req, res) => {
        if (!req.session.boAdvanced) {
            res.status(403).send('Available in Advanced configuration only.');
            return;
        }
        const purged = await purgeDeletedUser(String(req.params.id), new Config().avatarsPath);
        const users = await User.findAll({order: [['pseudo_3', 'ASC']]});
        res.send(await usersPage(
            req, users, getAvatarFilenames(new Config()),
            purged ? undefined : 'This player is not among the deleted players (already removed?).',
            purged ? `Player "${purged.user.pseudo_3}" permanently deleted, with ${purged.scoreCount} score(s).` : undefined,
        ));
    });

    app.post('/users/:id/restore', async (req, res) => {
        if (!req.session.boAdvanced) {
            res.status(403).send('Available in Advanced configuration only.');
            return;
        }
        const restored = await restoreDeletedUser(String(req.params.id));
        const users = await User.findAll({order: [['pseudo_3', 'ASC']]});
        res.send(await usersPage(
            req, users, getAvatarFilenames(new Config()),
            restored ? undefined : 'This player is not among the deleted players (already restored?).',
            restored ? `Player "${restored.pseudo_3}" restored, with their scores.` : undefined,
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

    // A favorite's marquee/flyer/logo, for the favorites list's hover previews (see
    // renderAssetIcon()). Read from the directories ui.ini points at, like the presence icons.
    app.get('/media/:kind/:file', (req, res) => {
        const {marqueePath, flyerPath, logoPath} = getMameLocations(getMameHomePath());
        const dirs: {[kind: string]: string | null} = {marquee: marqueePath, flyer: flyerPath, logo: logoPath};
        const dir = dirs[req.params.kind];
        // Same rom name character set as the favorites routes: no path separators, no dot dirs.
        if (!dir || !/^[a-z0-9_]+\.png$/.test(req.params.file)) {
            res.status(404).end();
            return;
        }
        // no-cache: revalidated (ETag) on every hover, so artwork re-downloaded from ScreenScraper
        // shows up without a stale copy. Served with a root for the same reason as /avatars below.
        res.sendFile(req.params.file, {root: dir, headers: {'Cache-Control': 'no-cache'}}, (error) => {
            if (error && !res.headersSent) {
                res.status(404).end();
            }
        });
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
        if (!req.session.boAdvanced) {
            res.status(403).send('Available in Advanced configuration only.');
            return;
        }
        const config = new Config(getSecretsKey(req));
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
        res.write(renderPageHead('screenscraper', getViewer(req)));
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
        const isAdvanced = req.session.boAdvanced === true;

        if (!req.file) {
            res.status(400).send(renderForm(
                values, getMameInfo(config), isAdvanced, undefined, undefined, undefined, 'No file received.',
            ));
            return;
        }

        // A clear BO-rendered error instead of a raw ENOENT surfacing from spawn() below - macOS
        // in particular doesn't always ship a working python3 without Xcode CLT installed.
        if (!isPython3Available()) {
            rmSync(req.file.path, {force: true});
            res.status(500).send(renderForm(
                values, getMameInfo(config), isAdvanced, undefined, undefined, undefined,
                'python3 not found on this machine - unable to import a starting pack.',
            ));
            return;
        }

        res.writeHead(200, {'Content-Type': 'text/html; charset=utf-8'});
        res.socket?.setNoDelay(true);
        res.write(renderPageHead('mame', getViewer(req)));

        // Validation (manifest.json/IMPORTABLE_MAME_DIRECTORIES, MAME config completeness) and
        // the actual import both happen inside the script now - it mirrors this same logic and
        // reports failures through its own stdout/stderr lines, same as /import/from-url below.
        const started = await runImportScript(
            res, `Import in progress… (${escapeHtml(req.file.originalname)})`, [req.file.path], {...process.env},
        );
        rmSync(req.file.path, {force: true});
        if (!started) {
            return;
        }

        streamFavoritesRefreshAfterImport(res, config);

        // Rest of the MAME tab, re-rendered fresh so e.g. the genre.ini/Multiplayer.ini fields
        // above reflect what the import just installed, instead of a "Retour" link to a
        // separate page.
        const refreshedMameInfo = getMameInfo(config);
        res.write(renderConfigCard(values, refreshedMameInfo));
        res.write(renderMameInfoCard(refreshedMameInfo));
        // Same gating as renderForm(): import only makes sense once the binary's configured and
        // validated (see there for why).
        if (!refreshedMameInfo.error) {
            res.write(renderPythonWarning());
            res.write(renderConfPackCard(config, refreshedMameInfo));
            res.write(renderImportCard());
        }
        res.write(renderPageTail());
        res.end();

        // Back through Init.vue, which re-seeds categories and re-syncs games from the new
        // favorites.ini/genre.ini - the front would otherwise keep showing the pre-import list.
        reloadFront();
    });

    // Same Advanced configuration gating as the Games tab's Repository subtab: configuring where
    // packs come from, and importing an arbitrary one from there, is no less consequential than
    // the manual upload right above it.
    app.post('/repo/save', async (req, res) => {
        if (!req.session.boAdvanced) {
            res.status(403).send('Available in Advanced configuration only.');
            return;
        }
        const config = new Config(getSecretsKey(req));
        config.load();
        // Trailing slash trimmed once here so every consumer (index.json fetch, pack download
        // URL) can always join with a bare '/', instead of each guarding against a possible
        // double slash.
        config.repoUrl = (req.body.repoUrl || '').trim().replace(/\/+$/, '');
        config.repoUser = (req.body.repoUser || '').trim();
        // Never pre-filled (see renderSavedPasswordAttributes()): left empty means unchanged.
        config.repoPassword = (req.body.repoPassword || '').trim() || config.repoPassword;
        config.save();

        res.send(await renderFavoritesTab(req, {}, {info: 'Repository configuration saved.'}));
    });

    // Proxied server-side (rather than the browser fetching index.json directly) so the repo's
    // basic-auth credentials never need to reach the browser at all.
    app.get('/import/from-url/packs', async (req, res) => {
        if (!req.session.boAdvanced) {
            res.status(403).send('Available in Advanced configuration only.');
            return;
        }
        const config = new Config(getSecretsKey(req));
        config.load();
        const mameInfo = getMameInfo(config);

        if (!config.repoUrl) {
            res.status(422).send(await renderFavoritesTab(req, {}, {error: 'Enter the repository URL before browsing it.'}));
            return;
        }
        if (getMissingConfPackFiles(mameInfo).length) {
            res.status(422).send(await renderFavoritesTab(req, {}, {
                error: 'Install the configuration pack first (MAME > Import tab).',
            }));
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
            // The configuration pack has its own card (see renderConfPackCard()).
            const packs = (data.packs ?? []).filter(pack => isGamePack(pack.filename));
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
            res.send(await renderFavoritesTab(req, {}, {packs}));
        } catch (error) {
            const message = error instanceof Error ? error.message : 'unexpected error';
            res.status(502).send(await renderFavoritesTab(req, {}, {error: `Unable to reach the repository: ${message}`}));
        }
    });

    // Not Advanced-only, unlike the game packs below: the carousel needs this pack to have genres.
    app.post('/import/conf-pack', async (req, res) => {
        const config = new Config(getSecretsKey(req));
        config.load();
        const values: ConfigFormValues = {mamePath: config.mamePath || ''};
        const isAdvanced = req.session.boAdvanced === true;
        const mameInfo = getMameInfo(config);

        if (!config.repoUrl) {
            res.status(422).send(renderForm(
                values, mameInfo, isAdvanced, undefined, undefined, undefined, 'Repository URL not configured.',
            ));
            return;
        }
        if (!isPython3Available()) {
            res.status(500).send(renderForm(
                values, mameInfo, isAdvanced, undefined, undefined, undefined,
                'python3 not found on this machine - unable to import from the repository.',
            ));
            return;
        }

        res.writeHead(200, {'Content-Type': 'text/html; charset=utf-8'});
        res.socket?.setNoDelay(true);
        res.write(renderPageHead('mame', getViewer(req)));
        if (!await runConfPackImport(res, config)) {
            return;
        }

        const refreshedMameInfo = getMameInfo(config);
        res.write(renderConfigCard(values, refreshedMameInfo));
        res.write(renderMameInfoCard(refreshedMameInfo));
        if (!refreshedMameInfo.error) {
            res.write(renderPythonWarning());
            res.write(renderConfPackCard(config, refreshedMameInfo));
            res.write(renderImportCard());
        }
        res.write(renderPageTail());
        res.end();

        // Back through Init.vue, which re-seeds the categories from the new files.
        reloadFront();
    });

    app.post('/import/from-url', async (req, res) => {
        if (!req.session.boAdvanced) {
            res.status(403).send('Available in Advanced configuration only.');
            return;
        }
        const config = new Config(getSecretsKey(req));
        config.load();
        // One "<pack>.zip|<romName>" per ticked game, grouped by pack (a game listed by several
        // packs is kept for the first). urlencoded (extended: false) yields a string for one
        // ticked box, an array for several; anything malformed is refused (see the function).
        const selection = groupSelectedGames(req.body?.game);

        if (!config.repoUrl) {
            res.status(422).send(await renderFavoritesTab(req, {}, {error: 'Repository URL not configured.'}));
            return;
        }
        if (selection && !selection.size) {
            res.status(422).send(await renderFavoritesTab(req, {}, {error: 'Tick at least one game to import.'}));
            return;
        }
        if (!selection) {
            res.status(422).send(await renderFavoritesTab(req, {}, {error: 'Invalid pack or game name.'}));
            return;
        }
        // A clear BO-rendered error instead of a raw ENOENT surfacing from spawn() below -
        // macOS in particular doesn't always ship a working python3 without Xcode CLT installed.
        if (!isPython3Available()) {
            res.status(500).send(await renderFavoritesTab(req, {}, {error: 'python3 not found on this machine - unable to import from the repository.'}));
            return;
        }

        res.writeHead(200, {'Content-Type': 'text/html; charset=utf-8'});
        res.socket?.setNoDelay(true);
        res.write(renderPageHead('favorites', getViewer(req)));

        // Packs are imported one after the other (one script run each, one progress card each):
        // the script rewrites favorites.ini and shared category files, so runs must not overlap.
        // Credentials go through env, never argv, so they don't leak via `ps`/
        // `/proc/<pid>/cmdline` (they already sit in Config's plaintext JSON file at the same
        // trust level as ssDevPassword).
        // The configuration pack first, every time (see ConfPack.ts): game packs no longer ship
        // the category files, so this keeps them matching the repository's.
        if (!await runConfPackImport(res, config)) {
            return;
        }
        if (getMissingConfPackFiles(getMameInfo(config)).length) {
            res.write('<p class="error flash">The configuration pack could not be installed: game packs not imported.</p>');
            res.write(renderPageTail());
            res.end();
            return;
        }

        // Several packs: one tab per pack instead of one card each (17 packs made a very long page).
        const tabbed = selection.size > 1;
        if (tabbed) {
            res.write(renderImportTabsOpen([...selection.keys()]));
        }
        for (const [index, [packFilename, romNames]] of [...selection.entries()].entries()) {
            const counter = selection.size > 1 ? `[${index + 1}/${selection.size}] ` : '';
            // --only: just these games are read from the pack (HTTP Range requests, no full download).
            const started = await runImportScript(
                res,
                `${counter}Import from the repository in progress… (${escapeHtml(packFilename)}, ${romNames.length} game(s))`,
                ['--url', `${config.repoUrl}/${packFilename}`, '--only', romNames.join(',')],
                {...process.env, MAUI_REPO_USER: config.repoUser, MAUI_REPO_PASSWORD: config.repoPassword},
                {index, total: selection.size},
                tabbed,
            );
            // false = launch failure, runImportScript already closed the response.
            if (!started) {
                return;
            }
        }
        if (tabbed) {
            res.write('</div></section>');
        }

        streamFavoritesRefreshAfterImport(res, config);

        res.write(renderRepoImportCard(config, getMameInfo(config)));
        res.write(renderPageTail());
        res.end();

        // Same as /import above.
        reloadFront();
    });

    app.get('/maui', async (req, res) => {
        const config = new Config();
        config.load();
        await sendMauiPage(req, res, config);
    });

    app.post('/maui/save', async (req, res) => {
        const config = new Config();
        config.load();
        // Advanced configuration option (see renderMauiCard()): the basic form has no such checkbox, which
        // must not read as "unchecked" and switch it off.
        if (req.session.boAdvanced === true) {
            config.openDevTools = req.body.openDevTools === 'on';
        }
        config.fullscreen = req.body.fullscreen === 'on';
        config.voteEnabled = req.body.voteEnabled === 'on';
        config.thumbsDownRemovesFavorite = req.body.thumbsDownRemovesFavorite === 'on';
        config.save();
        await sendMauiPage(req, res, config, {mauiInfo: 'Configuration saved.'});
    });

    app.post('/maui/online/save', async (req, res) => {
        if (refuseOnlineRequest(req, res)) {
            return;
        }
        const input = typeof req.body.configuration === 'string' ? req.body.configuration : '';
        const outcome = saveConfigurationString(input);
        if (outcome.ok) {
            // New credentials: an ONLINE session still running would keep the old ones.
            await online.restart();
        }
        const config = new Config();
        config.load();
        await sendMauiPage(req, res, config, outcome.ok
            ? {onlineInfo: 'Configuration saved. Use "Test connection" to check it.'}
            : {onlineError: outcome.error});
    });

    app.post('/maui/online/enabled', async (req, res) => {
        if (refuseOnlineRequest(req, res)) {
            return;
        }
        const result = setOnlineEnabled(req.body.enabled === 'on');
        if (result.level === 'info') {
            await online.restart();
        }
        const config = new Config();
        config.load();
        await sendMauiPage(req, res, config, result.level === 'info'
            ? {onlineInfo: result.message}
            : {onlineError: result.message});
    });

    app.post('/maui/online/test', async (req, res) => {
        if (refuseOnlineRequest(req, res)) {
            return;
        }
        const result = await testConnection();
        const config = new Config();
        config.load();
        await sendMauiPage(req, res, config, result.level === 'info'
            ? {onlineInfo: result.message}
            : {onlineError: result.message});
    });

    app.post('/maui/online/reset', async (req, res) => {
        if (refuseOnlineRequest(req, res)) {
            return;
        }
        const result = resetOnlineSettings();
        await online.restart();
        const config = new Config();
        config.load();
        await sendMauiPage(req, res, config, result.level === 'info'
            ? {onlineInfo: result.message}
            : {onlineError: result.message});
    });

    // Backup/restore of mame-awesome-ui's own config/database - Advanced configuration only (see the "Import /
    // export mame-awesome-ui" card, hidden outside Advanced configuration in renderMauiPage()).
    app.get('/maui/export', async (req, res) => {
        if (!req.session.boAdvanced) {
            res.status(403).send('Available in Advanced configuration only.');
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
        if (!req.session.boAdvanced) {
            res.status(403).send('Available in Advanced configuration only.');
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
            'maui', getViewer(req),
        ));

        setTimeout(onReset, 300);
    });

    // Not role-gated beyond being logged in for a real release - installing one of those onto
    // the device the BO itself runs on is exactly what a "user"-role account (e.g. puckman) is
    // meant to be able to do, same trust level as everything else on the "General" MAUI subtab.
    // A dev build (GitHub prerelease published from develop, see getUpdateInfo()) stays
    // Advanced configuration only even though the asset itself needs no auth to download - checked server-side
    // below, not just by hiding the row in renderUpdateCard(), since the tagName/assetUrl pair
    // is posted back by the client and could otherwise be forged by a "user"-role account.
    app.post('/maui/update/install', async (req, res) => {
        const config = new Config();
        config.load();
        const tagName = typeof req.body.tagName === 'string' ? req.body.tagName : '';
        const assetUrl = typeof req.body.assetUrl === 'string' ? req.body.assetUrl : '';
        const isAdvanced = req.session.boAdvanced === true;

        if (!isSelfUpdateCapable() || !assetUrl) {
            await sendMauiPage(req, res, config, {updateInfoError: 'Installation unavailable on this machine.'});
            return;
        }

        const preUpdateInfo = await getUpdateInfo();
        if (!isAdvanced && preUpdateInfo.devBuilds.some(build => build.tagName === tagName)) {
            res.status(403).send('Available in Advanced configuration only.');
            return;
        }

        res.writeHead(200, {'Content-Type': 'text/html; charset=utf-8'});
        res.socket?.setNoDelay(true);
        res.write(renderPageHead('maui', getViewer(req)));
        await runUpdateInstall(res, `Installing version ${tagName}…`, assetUrl);

        const updateInfo = await getUpdateInfo();
        res.write(renderMauiCard(config, isAdvanced));
        res.write(renderUpdateCard(updateInfo, isAdvanced));
        if (isAdvanced) {
            res.write(renderMauiImportExportCard());
            res.write(renderMauiDangerZoneCard());
        }
        res.write(renderPageTail());
        res.end();
    });

    // Same access as the installation just above (any BO account): restarting only relaunches the
    // app on what ~/squashfs-root already holds, it changes nothing on disk. Refused unless this is
    // the dedicated Pi layout (isSelfUpdateCapable()) and sudo allows that one command without a
    // password (docs/RASPBERRY-PI-DEPLOY.md §5.7) - checked up front so a missing rule shows an
    // explanation instead of a page waiting for a restart that never comes.
    app.post('/maui/update/restart', async (req, res) => {
        const config = new Config();
        config.load();

        if (!isSelfUpdateCapable()) {
            await sendMauiPage(req, res, config, {updateInfoError: 'Restart unavailable on this machine.'});
            return;
        }
        if (!await canRestartKiosk()) {
            await sendMauiPage(req, res, config, {
                updateInfoError: 'The application cannot be restarted from here: the user is not allowed to '
                    + 'run the restart through sudo without a password (see docs/RASPBERRY-PI-DEPLOY.md §5.7).',
            });
            return;
        }

        res.send(renderPage(
            '<section class="card"><h2>Restarting the application</h2>'
            + '<p class="info">The screen goes blank for a moment, then the application reopens on the '
            + 'version installed in <code>~/squashfs-root</code>.</p>'
            + '<p id="restart-wait-message" class="info">Waiting for the restart… this page will '
            + 'automatically take you back to the MAUI tab as soon as the server is available again.</p>'
            + renderRestartWaitScript('/maui')
            + '</section>',
            'maui', getViewer(req),
        ));

        // Delayed so this response finishes flushing before the session - this process included -
        // goes down.
        setTimeout(restartKiosk, 500);
    });

    app.post('/screenscraper/save', (req, res) => {
        if (!req.session.boAdvanced) {
            res.status(403).send('Available in Advanced configuration only.');
            return;
        }
        const values: ScreenScraperValues = {
            ssDevId: (req.body.ssDevId || '').trim(),
            ssDevPassword: (req.body.ssDevPassword || '').trim(),
            ssSoftName: (req.body.ssSoftName || '').trim(),
            ssUserId: (req.body.ssUserId || '').trim(),
            ssUserPassword: (req.body.ssUserPassword || '').trim(),
            bezelAspect: req.body.bezelAspect === '4:3' ? '4:3' : '16:9',
        };

        const config = new Config(getSecretsKey(req));
        config.load();
        config.ssDevId = values.ssDevId;
        // Password fields are never pre-filled (see renderSavedPasswordAttributes()): left empty
        // means unchanged.
        config.ssDevPassword = values.ssDevPassword || config.ssDevPassword;
        config.ssSoftName = values.ssSoftName;
        config.ssUserId = values.ssUserId;
        config.ssUserPassword = values.ssUserPassword || config.ssUserPassword;
        config.bezelAspect = values.bezelAspect;
        config.save();

        res.send(renderScreenScraperPage(
            {...values, ssDevPassword: config.ssDevPassword, ssUserPassword: config.ssUserPassword},
            hasScreenScraperCredentials(config), undefined, 'ScreenScraper configuration saved.',
        ));
    });

    app.get('/browse', (req, res) => {
        const target: PathField = req.query.target === 'pluginsPath' ? 'pluginsPath' : 'mamePath';
        const carried: Record<PathField, string> = {
            mamePath: typeof req.query.mamePath === 'string' ? req.query.mamePath : '',
            pluginsPath: typeof req.query.pluginsPath === 'string' ? req.query.pluginsPath : '',
        };
        const initialValue = carried[target];

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

        res.send(renderBrowsePage(target, currentDir, carried, getViewer(req)));
    });

    app.post('/save', (req, res) => {
        const mamePath: string = (req.body.mamePath || '').trim();
        const pluginsPath: string = (req.body.pluginsPath || '').trim();
        // "Launch MAME fullscreen" checkbox: unchecked = windowed (mame.ini's window 1). Only
        // posted while the binary folder is filled in (disabled otherwise, see renderConfigCard()).
        const windowed = req.body.fullscreen !== 'on';
        const config = new Config();
        config.load();
        const isAdvanced = req.session.boAdvanced === true;
        // On an error below, the page comes back with what was typed in both fields.
        const typedMameInfo = () => {
            const mameInfo = getMameInfo(config);
            if (pluginsPath) {
                mameInfo.pluginsPath = pluginsPath;
            }
            if (mamePath) {
                mameInfo.windowed = windowed;
            }
            return mameInfo;
        };

        if (!existsSync(mamePath)) {
            res.status(422).send(renderForm(
                {mamePath}, typedMameInfo(), isAdvanced,
                `The folder "${mamePath}" does not exist.`,
            ));
            return;
        }
        const mameBinaryName = findMameBinary(mamePath);
        if (!mameBinaryName) {
            res.status(422).send(renderForm(
                {mamePath}, typedMameInfo(), isAdvanced,
                `No mame binary found in "${mamePath}".`,
            ));
            return;
        }

        try {
            ensureMameConfigBootstrapped(join(mamePath, mameBinaryName), getMameHomePath());
        } catch (error) {
            res.status(422).send(renderForm(
                {mamePath}, typedMameInfo(), isAdvanced,
                'Failed to initialize mame ("-createconfig"): '
                    + `${error instanceof Error ? error.message : 'unexpected error'}.`,
            ));
            return;
        }

        // mame.ini exists from here on (ensureMameConfigBootstrapped() above).
        const plugins = pluginsPath ? savePluginsPath(pluginsPath) : null;
        setMameIniValue(join(getMameHomePath(), 'mame.ini'), 'window', windowed ? '1' : '0');

        config.mamePath = mamePath;
        config.mameBinaryName = mameBinaryName;
        config.save();

        res.send(renderPage(
            '<section class="card"><h2>Configuration saved</h2><p>'
            + 'The application restarts automatically.</p>'
            + (plugins?.pluginsAdded ? `<p>${plugins.pluginsAdded} plugin(s) initialized in plugin.ini.</p>` : '')
            + (plugins && !plugins.saved ? '<p class="error">The plugins folder could not be saved: mame.ini not found.</p>' : '')
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
            'mame', getViewer(req),
        ));

        reloadFront();
    });

    /**
     * Writes pluginspath into mame.ini and, as soon as it points at a folder that actually has
     * plugins in it, initializes/completes plugin.ini right away instead of making the user click
     * the separate "Repair plugin.ini" button as a second step. saved: false when mame.ini
     * doesn't exist.
     */
    const savePluginsPath = (pluginsPath: string): {saved: boolean; pluginsAdded: number} => {
        const iniPath = getMameHomePath();
        const saved = setMameIniValue(join(iniPath, 'mame.ini'), 'pluginspath', pluginsPath);
        const availablePlugins = getAvailablePlugins(resolveDirectoryPath(pluginsPath, iniPath));
        const pluginsAdded = saved && availablePlugins.length
            ? repairPluginIni(join(iniPath, 'plugin.ini'), availablePlugins)
            : 0;
        return {saved, pluginsAdded};
    };

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
            getMameInfo(config), req.session.boAdvanced === true,
            undefined,
            undefined,
            added
                ? `${added} plugin(s) added to plugin.ini (mame default values).`
                : 'Nothing to repair: plugin.ini already contains all the detected plugins (or no plugin was found - check the plugins folder below).',
        ));
    });

    app.post('/input-probe/devices', (req, res) => {
        const config = new Config();
        config.load();
        const mameInfo = getMameInfo(config);
        const isAdvanced = req.session.boAdvanced === true;

        const romNames = mameInfo.romPath ? listRomNames(mameInfo.romPath) : [];
        const romName = romNames[0];

        if (mameInfo.error || !romName) {
            // Shouldn't normally be reachable - the form only renders once mameInfo.error is unset
            // and at least one rom exists, but the config could have changed underneath a stale
            // form submission (e.g. mamePath cleared in another tab/request).
            res.status(422).send(renderForm(
                {mamePath: config.mamePath || ''}, mameInfo, isAdvanced,
            ));
            return;
        }

        try {
            const result = runDeviceProbe(join(config.mamePath, config.mameBinaryName), mameInfo.iniPath, romName);
            res.send(renderForm(
                {mamePath: config.mamePath}, mameInfo, isAdvanced,
                undefined, undefined, undefined, undefined, undefined,
                {result},
            ));
        } catch (error) {
            console.error('[boServer] Device probe failed:', error);
            const message = error instanceof Error ? error.message : 'unexpected error';
            res.status(500).send(renderForm(
                {mamePath: config.mamePath}, mameInfo, isAdvanced,
                undefined, undefined, undefined, undefined, undefined,
                {error: `Device probe failed: ${message} (timeout, non-zero exit code, or binary not found).`},
            ));
        }
    });

    // Pins (or with an empty joycode, unpins) a detected device to a fixed JOY number in the
    // controller file (see getCtrlrFile()), then probes again so the cards show MAME's new numbering.
    app.post('/input-probe/devices/pin', (req, res) => {
        const config = new Config();
        config.load();
        const mameInfo = getMameInfo(config);
        const isAdvanced = req.session.boAdvanced === true;
        const renderWith = (state: DeviceProbeState, status = 200) => res.status(status).send(renderForm(
            {mamePath: config.mamePath || ''}, mameInfo, isAdvanced,
            undefined, undefined, undefined, undefined, undefined,
            state,
        ));

        const deviceId = typeof req.body.deviceId === 'string' ? req.body.deviceId : '';
        const joycode = typeof req.body.joycode === 'string' ? req.body.joycode : '';
        const romName = mameInfo.romPath ? listRomNames(mameInfo.romPath)[0] : undefined;
        if (mameInfo.error || !romName || !config.mamePath || !config.mameBinaryName) {
            // Same "shouldn't normally be reachable" caveat as /input-probe/devices above.
            renderWith({error: 'No valid MAME configuration saved: unable to launch MAME.'}, 422);
            return;
        }
        if (!deviceId || (joycode && !/^JOYCODE_\d+$/.test(joycode))) {
            renderWith({error: 'Invalid device or JOY number.'}, 400);
            return;
        }

        try {
            pinDevice(mameInfo, deviceId, joycode || null);
        } catch (error) {
            console.error('[boServer] Device pin failed:', error);
            renderWith({error: `Could not write the controller file: ${error instanceof Error ? error.message : 'unexpected error'}.`}, 500);
            return;
        }
        const info = joycode
            ? `Pinned as JOY ${joycodeNumber(joycode)} (${getCtrlrFile(mameInfo).path}).`
            : 'Unpinned: MAME numbers this device in detection order again.';
        try {
            renderWith({result: runDeviceProbe(join(config.mamePath, config.mameBinaryName), mameInfo.iniPath, romName), info});
        } catch (error) {
            console.error('[boServer] Device probe failed:', error);
            renderWith({info, error: `Device probe failed: ${error instanceof Error ? error.message : 'unexpected error'}.`}, 500);
        }
    });

    app.post('/input-probe/mame/start', (req, res) => {
        const config = new Config();
        config.load();
        const mameInfo = getMameInfo(config);
        const isAdvanced = req.session.boAdvanced === true;

        // MAME only runs the capture script (-autoboot_script) once a machine is running - opened
        // on its own menu, with no rom, it never does (checked against 0.289) - so the session
        // needs a rom, any of them: default.cfg is global.
        const romNames = mameInfo.romPath ? listRomNames(mameInfo.romPath) : [];
        const romName = romNames[0];
        if (mameInfo.error || !romName) {
            res.status(422).send(renderForm(
                {mamePath: config.mamePath || ''}, mameInfo, isAdvanced,
                mameInfo.error
                    ? 'No valid MAME configuration saved: unable to launch MAME.'
                    : 'No rom found in the roms folder - MAME needs at least one to launch.',
            ));
            return;
        }

        startMameConfigSession(join(config.mamePath, config.mameBinaryName), mameInfo.iniPath, romName);
        res.send(renderForm({mamePath: config.mamePath}, mameInfo, isAdvanced));
    });

    // Polled by the page while a config session runs (see renderPageTail()), so it notices MAME
    // being closed from its own window.
    app.get('/input-probe/mame/status', (req, res) => {
        res.json({running: isMameConfigSessionAlive()});
    });

    app.post('/input-probe/mame/stop', (req, res) => {
        const config = new Config();
        config.load();
        const mameInfo = getMameInfo(config);
        const isAdvanced = req.session.boAdvanced === true;

        stopMameConfigSession();

        res.send(renderForm({mamePath: config.mamePath}, mameInfo, isAdvanced));
    });

    app.post('/input-probe/remap', (req, res) => {
        const config = new Config();
        config.load();
        const mameInfo = getMameInfo(config);
        const isAdvanced = req.session.boAdvanced === true;

        const portType: string = (req.body.portType || '').trim();
        const action = REMAP_ACTIONS_BY_TYPE.get(portType);
        // Defaults to capture: a form rendered before the Reset button existed posts no action.
        const formAction: string = (req.body.action || 'capture').trim();

        if (mameInfo.error || !action || !['capture', 'reset'].includes(formAction)) {
            // mameInfo.error: same "shouldn't normally be reachable" caveat as /input-probe/devices
            // above - the form only renders once mameInfo.error is unset. !action: portType isn't in
            // REMAP_ACTIONS_BY_TYPE - only reachable by posting outside the rendered form, since
            // every form's hidden portType field is one of ours.
            res.status(422).send(renderForm(
                {mamePath: config.mamePath || ''}, mameInfo, isAdvanced,
            ));
            return;
        }

        // Both actions need MAME open (their buttons are disabled otherwise) - only reachable from a
        // page rendered before MAME was closed.
        if (!isMameConfigSessionAlive()) {
            res.send(renderForm(
                {mamePath: config.mamePath}, mameInfo, isAdvanced,
                undefined, undefined, undefined, undefined, undefined,
                undefined,
                {portType, error: 'MAME is not running - click "Launch MAME" first.'},
            ));
            return;
        }

        if (formAction === 'reset') {
            // Edits default.cfg directly - the running MAME is only needed so the edit is
            // replayed once it exits (see applyCfgEdit()).
            try {
                const cfgPath = getDefaultCfgPath(mameInfo.iniPath);
                applyCfgEdit(() => removeDefaultCfgUiInput(cfgPath, portType));
                res.send(renderForm(
                    {mamePath: config.mamePath}, mameInfo, isAdvanced,
                    undefined, undefined, undefined, undefined, undefined,
                    undefined,
                    {portType},
                ));
            } catch (error) {
                console.error(`[boServer] Remap reset failed for "${portType}":`, error);
                const message = error instanceof Error ? error.message : 'unexpected error';
                res.status(500).send(renderForm(
                    {mamePath: config.mamePath}, mameInfo, isAdvanced,
                    undefined, undefined, undefined, undefined, undefined,
                    undefined,
                    {portType, error: `Reset failed: ${message}`},
                ));
            }
            return;
        }

        try {
            const token = captureOnePress();
            const remapState: RemapState = token
                ? {portType, capturedToken: token}
                : {portType, error: 'No press detected within the allotted time (30s) - try again ' +
                    '(is the gamepad connected, and MAME still open?).'};
            if (token) {
                const cfgPath = getDefaultCfgPath(mameInfo.iniPath);
                applyCfgEdit(() => setDefaultCfgUiInput(cfgPath, portType, token));
                const released = releaseTokenFromInGameUiPorts(cfgPath, portType, token);
                if (released.length) {
                    remapState.releasedFrom = released;
                }
            }
            res.send(renderForm(
                {mamePath: config.mamePath}, mameInfo, isAdvanced,
                undefined, // error
                undefined, // info
                undefined, // mameInfoMessage
                undefined, // importError
                undefined, // dangerZoneInfo
                undefined, // deviceProbeState
                remapState,
            ));
        } catch (error) {
            console.error(`[boServer] Remap capture failed for "${portType}":`, error);
            const message = error instanceof Error ? error.message : 'unexpected error';
            res.status(500).send(renderForm(
                {mamePath: config.mamePath}, mameInfo, isAdvanced,
                undefined, // error
                undefined, // info
                undefined, // mameInfoMessage
                undefined, // importError
                undefined, // dangerZoneInfo
                undefined, // deviceProbeState
                {portType, error: `Capture failed: ${message}`},
            ));
        }
    });

    // Renders the whole page with only the per-game remap state set (renderForm() has a long
    // positional list - see /input-probe/remap above).
    const renderGameRemapPage = (config: Config, mameInfo: MameInfo, isAdvanced: boolean, gameRemapState: GameRemapState): string =>
        renderForm(
            {mamePath: config.mamePath}, mameInfo, isAdvanced,
            undefined, // error
            undefined, // info
            undefined, // mameInfoMessage
            undefined, // importError
            undefined, // dangerZoneInfo
            undefined, // deviceProbeState
            undefined, // remapState
            gameRemapState,
        );

    app.post('/input-probe/game/start', (req, res) => {
        const config = new Config();
        config.load();
        const mameInfo = getMameInfo(config);
        const isAdvanced = req.session.boAdvanced === true;

        const romName: string = (req.body.romName || '').trim();
        const romNames = mameInfo.romPath ? listRomNames(mameInfo.romPath) : [];
        if (mameInfo.error || !romNames.includes(romName)) {
            // Same "shouldn't normally be reachable" caveat as /input-probe/devices above - the
            // form only renders once mameInfo.error is unset, with a select of the roms actually present.
            res.status(422).send(renderForm({mamePath: config.mamePath || ''}, mameInfo, isAdvanced));
            return;
        }

        startMameConfigSession(join(config.mamePath, config.mameBinaryName), mameInfo.iniPath, romName, true);
        waitForSessionGameFields(10000);
        res.send(renderGameRemapPage(config, mameInfo, isAdvanced, {romName}));
    });

    app.post('/input-probe/game/remap', (req, res) => {
        const config = new Config();
        config.load();
        const mameInfo = getMameInfo(config);
        const isAdvanced = req.session.boAdvanced === true;

        const romName: string = (req.body.romName || '').trim();
        const fieldId: string = (req.body.fieldId || '').trim();
        const action: string = (req.body.action || '').trim();
        const romNames = mameInfo.romPath ? listRomNames(mameInfo.romPath) : [];
        // romName is only ever used to build cfg/<romName>.cfg below, so it has to be one of the
        // roms actually present - never a client-supplied path fragment.
        if (mameInfo.error || !romNames.includes(romName) || !['capture', 'reset'].includes(action)) {
            res.status(422).send(renderForm({mamePath: config.mamePath || ''}, mameInfo, isAdvanced));
            return;
        }

        // The field is looked up in what MAME itself dumped for the running game: its tag/mask/
        // defvalue are what the cfg entry needs to be applied, and none of it comes from the client.
        const field = isMameConfigSessionAlive() && mameConfigSession?.romName === romName
            ? readSessionGameFields()?.find(candidate => gameFieldId(candidate) === fieldId)
            : undefined;
        if (!field) {
            res.send(renderGameRemapPage(config, mameInfo, isAdvanced, {
                romName,
                error: `MAME is not running with "${romName}" (or doesn't know this command) - launch it again below.`,
            }));
            return;
        }

        try {
            const cfgPath = getGameCfgPath(mameInfo.iniPath, romName);
            if (action === 'reset') {
                applyCfgEdit(() => removeGameCfgOverride(cfgPath, field));
                res.send(renderGameRemapPage(config, mameInfo, isAdvanced, {romName, fieldId}));
                return;
            }

            const token = captureOnePress();
            const gameRemapState: GameRemapState = token
                ? {romName, fieldId, capturedToken: token}
                : {romName, fieldId, error: 'No press detected within the allotted time (30s) - try again ' +
                    '(is the gamepad connected, and MAME still open?).'};
            if (token) {
                applyCfgEdit(() => setGameCfgOverride(cfgPath, romName, field, token));
                const released = releaseTokenFromInGameUiPorts(getDefaultCfgPath(mameInfo.iniPath), field.portType, token);
                if (released.length) {
                    gameRemapState.releasedFrom = released;
                }
            }
            res.send(renderGameRemapPage(config, mameInfo, isAdvanced, gameRemapState));
        } catch (error) {
            console.error(`[boServer] Game remap failed for "${romName}" / "${field.portType}":`, error);
            const message = error instanceof Error ? error.message : 'unexpected error';
            res.status(500).send(renderGameRemapPage(config, mameInfo, isAdvanced, {
                romName,
                fieldId,
                error: `${action === 'reset' ? 'Reset' : 'Capture'} failed: ${message}`,
            }));
        }
    });

    app.post('/reset', async (req, res) => {
        if (!req.session.boAdvanced) {
            res.status(403).send('Available in Advanced configuration only.');
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
                + renderRestartWaitScript(backHref)
            + '</section>',
            zone, getViewer(req),
        ));

        // Only closes the app (see onReset in background.ts) - it does NOT relaunch it. Delayed
        // slightly so this response finishes flushing to the browser before the process exits.
        setTimeout(onReset, 300);
    });

    const server = app.listen(port, () => {
        console.log(`BO server listening on http://localhost:${port}`);
    });
    return {server, databaseReady, online};
}
