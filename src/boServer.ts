import express, {Response} from 'express';
import session from 'express-session';
import {Server} from 'http';
import {
    existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync,
    chmodSync, renameSync, createWriteStream,
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
        throw new Error(`"${uiIniPath}" introuvable après -createconfig.`);
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
 * instead of re-running it on every page load; only "Mettre à jour les favoris" re-resolves and
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
            error: 'Configurez le binaire mame (onglet Config) pour voir le chemin des roms.',
        };
    }

    const mameBinary = join(config.mamePath, config.mameBinaryName);
    if (!existsSync(mameBinary)) {
        return {
            iniPath, mameIniPath, uiIniPath, pluginIniPath, romPath: null, marqueePath, flyerPath, logoPath,
            favoritesPath, genreIniPath, nplayersIniPath, windowed, pluginsPath, missingPlugins, showConfig: null,
            error: `Le binaire "${mameBinary}" est introuvable.`,
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
            error: 'Impossible de lire la configuration mame ("-showconfig" a échoué).',
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
    // False when this rom has no entry in the favorites cache yet (added since the last "Mettre
    // à jour les favoris") - fullname then just falls back to romName and biosName/deviceRoms to
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
        return {error: 'Aucun favori pour l\'instant - ajoutez-en depuis le menu de MAME (Tab en jeu).'};
    }

    const romNames = getFavoriteRomNames(favoritesPath);
    if (!romNames.length) {
        return {error: 'Le fichier favorites.ini ne contient aucun favori pour l\'instant.'};
    }

    if (!config.mamePath || !config.mameBinaryName) {
        return {error: 'Configurez le binaire mame dans l\'onglet MAME pour afficher le nom des favoris.'};
    }
    const mameBinary = join(config.mamePath, config.mameBinaryName);
    if (!existsSync(mameBinary)) {
        return {error: `Le binaire "${mameBinary}" est introuvable.`};
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
 * favorites list streams in instead of blocking the whole response. Only used by "Mettre à jour
 * les favoris" (POST /favorites/refresh) now - the normal favorites tab reads the cache this
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
            onProgress(`${row.romName} : déjà complet, ignoré.`);
            continue;
        }

        const result = await client.fetchGameMedia(row.romName);

        if (result.status === 'quota-exceeded') {
            summary.stoppedForQuota = true;
            summary.errors.push(`${row.romName}: quota ScreenScraper dépassé, arrêt du traitement.`);
            onProgress(`${row.romName} : quota ScreenScraper dépassé, arrêt du traitement.`);
            break;
        }
        if (result.status === 'not-found') {
            summary.notFound++;
            onProgress(`${row.romName} : introuvable sur ScreenScraper.`);
            continue;
        }
        if (result.status === 'error') {
            summary.errors.push(`${row.romName}: ${result.message}`);
            onProgress(`${row.romName} : erreur (${result.message}).`);
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
            onProgress(`${row.romName} : trouvé, mais aucun visuel disponible.`);
        } else {
            const parts: string[] = [];
            if (downloadedKinds.length) {
                parts.push(`${downloadedKinds.join(' et ')} téléchargé(s)`);
            }
            if (failedKinds.length) {
                parts.push(`${failedKinds.join(' et ')} en erreur`);
            }
            onProgress(`${row.romName} : ${parts.join(', ')}.`);
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
): Promise<boolean> {
    const scriptPath = join(getScriptsPath(), 'import-starting-pack.py');
    res.write(`<section class="card"><h2>${title}</h2><ul class="progress-log">`);

    return new Promise(resolve => {
        const child = spawn('python3', [scriptPath, ...scriptArgs], {env});

        const writeLine = (line: string): void => {
            if (line.trim()) {
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
            res.write(`</ul><p class="error">${escapeHtml(`Échec du lancement : ${error.message}`)}</p></section>`);
            res.write(renderPageTail());
            res.end();
            resolve(false);
        });

        child.on('close', () => {
            stdoutSplitter.flush();
            stderrSplitter.flush();
            res.write('</ul></section>');
            resolve(true);
        });
    });
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
function renderPageHead(active: Tab = 'mame', authenticated: boolean = true, hasSubtabs: boolean = false): string {
    return `<!DOCTYPE html>
<html lang="fr">
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
           the row - see the "Supprimer tout le repertoire" row this was written for). */
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
        .progress-log {
            list-style: none;
            padding: 0;
            margin: 16px 0;
            max-height: 320px;
            overflow-y: auto;
            font-family: monospace;
            font-size: 0.9em;
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
    <header>
        <h1>mame-awesome-ui</h1>
        ${authenticated ? `<nav class="tabs${hasSubtabs ? ' compact' : ''}">
            <a href="/" class="${active === 'mame' ? 'active' : ''}">MAME</a>
            <a href="/favorites" class="${active === 'favorites' ? 'active' : ''}">Favoris</a>
            <a href="/users" class="${active === 'users' ? 'active' : ''}">Players</a>
            <a href="/screenscraper" class="${active === 'screenscraper' ? 'active' : ''}">ScreenScraper</a>
            <a href="/maui" class="${active === 'maui' ? 'active' : ''}">MAUI</a>
            <a href="/account" class="${active === 'account' ? 'active' : ''}">Mon compte</a>
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
                    button.textContent = button.textContent + '…';
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
        // "python3 introuvable", also carries one and would otherwise wrongly outrank the
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
            <h2>Connexion</h2>
            ${error ? `<p class="error flash">${escapeHtml(error)}</p>` : ''}
            <!-- Deliberately no "required" here: with two fields, pressing Enter in one while
                 the other is still empty triggers the browser's native validation instead of
                 submitting - easy to miss (the message lands on the other, unfocused field),
                 and looks like "Enter does nothing". /login already handles a blank/wrong
                 username or password gracefully (401 + "Identifiant ou mot de passe
                 incorrect."), so letting the browser send an incomplete submission and having
                 the server reject it is simpler than fighting native validation here. -->
            <form method="post" action="/login">
                <label for="username">Identifiant</label>
                <input type="text" id="username" name="username" autofocus>
                <label for="password">Mot de passe</label>
                <input type="password" id="password" name="password">
                <button type="submit">Se connecter</button>
            </form>
        </section>
    `, 'mame', false);
}

function renderAccountPage(username: string, role: string, error?: string, info?: string): string {
    return renderPage(`
        <section class="card">
            <h2>Mon compte</h2>
            <p>Connecté en tant que <strong>${escapeHtml(username)}</strong> (${escapeHtml(role)}).</p>
            ${error ? `<p class="error flash">${escapeHtml(error)}</p>` : ''}
            ${info ? `<p class="info flash">${escapeHtml(info)}</p>` : ''}
            <form method="post" action="/account/password">
                <label for="currentPassword">Mot de passe actuel</label>
                <input type="password" id="currentPassword" name="currentPassword" required>
                <label for="newPassword">Nouveau mot de passe</label>
                <input type="password" id="newPassword" name="newPassword" required minlength="4">
                <label for="confirmPassword">Confirmer le nouveau mot de passe</label>
                <input type="password" id="confirmPassword" name="confirmPassword" required minlength="4">
                <button type="submit">Changer le mot de passe</button>
            </form>
        </section>
        <section class="card">
            <form method="post" action="/logout">
                <button type="submit">Se déconnecter</button>
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
                <label for="mamePath">Dossier contenant le binaire mame</label>
                <div class="path-row">
                    <input type="text" id="mamePath" name="mamePath" value="${escapeHtml(values.mamePath)}">
                    <button type="submit" name="target" value="mamePath" formaction="/browse" formmethod="get">Parcourir</button>
                </div>
                <div class="button-row">
                    <button type="submit">Enregistrer</button>
                    ${isAdmin ? `<button type="submit" formaction="/launch" formmethod="post" class="launch-button">
                        <img src="/mame-logo.svg" alt="" class="launch-logo">
                        Lancer mame
                    </button>` : ''}
                </div>
            </form>
        </section>
    `;
}

/**
 * Green check / red cross next to each Informations MAME field below, so a missing path/file
 * is visible at a glance instead of only readable from the "Non disponible"/"Introuvable" text
 * next to it (kept as well, for screen readers and anyone not distinguishing the colors).
 */
function renderFoundIcon(found: boolean): string {
    return found
        ? `<span class="found-icon found-yes" title="Trouvé" aria-hidden="true">
            <svg width="14" height="14" viewBox="0 0 16 16">
                <path d="M3 8.5 L6.5 12 L13 4" fill="none" stroke="currentColor" stroke-width="2"
                    stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
        </span>`
        : `<span class="found-icon found-no" title="Introuvable" aria-hidden="true">
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
                <h2>Informations MAME</h2>
                <p class="error flash">${escapeHtml(mameInfo.error)}</p>
            </section>
        `;
    }
    return `
        <section class="card">
            <h2>Informations MAME</h2>
            ${info ? `<p class="info flash">${escapeHtml(info)}</p>` : ''}
            <dl>
                <div class="info-field">
                    <dt>Dossier home mame (ini, cfg, nvram, snapshots...)</dt>
                    <dd>${renderFoundIcon(existsSync(mameInfo.iniPath))}${escapeHtml(mameInfo.iniPath)}</dd>
                </div>
                <div class="info-field">
                    <dt>Fichier mame.ini</dt>
                    <dd>${renderFoundIcon(existsSync(mameInfo.mameIniPath))}${escapeHtml(mameInfo.mameIniPath)}</dd>
                </div>
                <div class="info-field">
                    <dt>Fichier ui.ini</dt>
                    <dd>${renderFoundIcon(existsSync(mameInfo.uiIniPath))}${escapeHtml(mameInfo.uiIniPath)}</dd>
                </div>
                <div class="info-field">
                    <dt>Fichier plugin.ini</dt>
                    <dd>${renderFoundIcon(existsSync(mameInfo.pluginIniPath))}${escapeHtml(mameInfo.pluginIniPath)}</dd>
                </div>
                <div class="info-field">
                    <dt>Dossier des roms (rompath)</dt>
                    <dd>${renderFoundIcon(!!mameInfo.romPath)}${mameInfo.romPath
                        ? escapeHtml(mameInfo.romPath) : '<em>Non disponible</em>'}</dd>
                </div>
                <div class="info-field">
                    <dt>Dossier des marquees (marquees_directory)</dt>
                    <dd>${renderFoundIcon(!!mameInfo.marqueePath)}${mameInfo.marqueePath
                        ? escapeHtml(mameInfo.marqueePath) : '<em>Non disponible</em>'}</dd>
                </div>
                <div class="info-field">
                    <dt>Dossier des flyers (flyers_directory)</dt>
                    <dd>${renderFoundIcon(!!mameInfo.flyerPath)}${mameInfo.flyerPath
                        ? escapeHtml(mameInfo.flyerPath) : '<em>Non disponible</em>'}</dd>
                </div>
                <div class="info-field">
                    <dt>Dossier des logos (logos_directory)</dt>
                    <dd>${renderFoundIcon(!!mameInfo.logoPath)}${mameInfo.logoPath
                        ? escapeHtml(mameInfo.logoPath) : '<em>Non disponible</em>'}</dd>
                </div>
                <div class="info-field">
                    <dt>Fichier des favoris (favorites.ini)</dt>
                    <dd>${renderFoundIcon(!!mameInfo.favoritesPath)}${mameInfo.favoritesPath
                        ? escapeHtml(mameInfo.favoritesPath)
                        : '<em>Aucun favori pour l\'instant — ajoutez-en depuis le menu de MAME (Tab en jeu).</em>'}</dd>
                </div>
                <div class="info-field">
                    <dt>Fichier des genres (genre.ini, categorypath)</dt>
                    <dd>${renderFoundIcon(!!mameInfo.genreIniPath)}${mameInfo.genreIniPath
                        ? escapeHtml(mameInfo.genreIniPath)
                        : '<em>Introuvable — importez un starting pack (onglet Import) pour '
                            + 'l\'installer au chemin indiqué par categorypath dans ui.ini.</em>'}</dd>
                </div>
                <div class="info-field">
                    <dt>Fichier du nombre de joueurs (Multiplayer.ini, categorypath)</dt>
                    <dd>${renderFoundIcon(!!mameInfo.nplayersIniPath)}${mameInfo.nplayersIniPath
                        ? escapeHtml(mameInfo.nplayersIniPath)
                        : '<em>Introuvable — importez un starting pack (onglet Import) pour '
                            + 'l\'installer au chemin indiqué par categorypath dans ui.ini.</em>'}</dd>
                </div>
            </dl>
            <form method="post" action="/mame-options/save">
                <label for="pluginsPath">Dossier des plugins MAME (pluginspath)</label>
                <div class="path-row">
                    <input type="text" id="pluginsPath" name="pluginsPath" value="${escapeHtml(mameInfo.pluginsPath || '')}">
                    <button type="submit" name="target" value="pluginsPath" formaction="/browse" formmethod="get">Parcourir</button>
                </div>
                <label class="checkbox-row">
                    <input type="checkbox" name="windowed" ${mameInfo.windowed ? 'checked' : ''}>
                    Lancer MAME en mode fenêtré (au lieu du plein écran) - modifie mame.ini
                </label>
                <button type="submit">Enregistrer</button>
            </form>
            ${mameInfo.missingPlugins.length ? `
                <form method="post" action="/mame-options/repair-plugins">
                    <p class="error flash">plugin.ini est incomplet : ${mameInfo.missingPlugins.length} plugin(s)
                    détecté(s) dans le dossier des plugins mais absent(s) de plugin.ini
                    (${escapeHtml(mameInfo.missingPlugins.join(', '))}).</p>
                    <button type="submit">Réparer plugin.ini (ajouter les plugins manquants)</button>
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
            <h2>Zone dangereuse</h2>
            <p class="error">Suppressions ciblées et irréversibles, portant sur les données de
            MAME lui-même. Chaque case agit indépendamment des autres - cochez ce que vous voulez
            supprimer puis validez. La suppression des roms/médias supprime aussi les roms
            elles-mêmes, pas seulement les visuels.</p>
            ${info ? `<p class="info flash">${escapeHtml(info)}</p>` : ''}
            <form method="post" action="/reset" onsubmit="
                var items = [];
                if (this.deleteMameHome.checked) {
                    items.push('tout le repertoire .mame et son contenu (configuration mame.ini/ui.ini, roms, medias, hiscores, cfg, nvram, snapshots...)');
                } else {
                    if (this.deleteHiscores.checked) items.push('les hiscores');
                    if (this.deleteGamesMedia.checked) items.push('les roms et medias des jeux (roms, marquees, flyers, logos)');
                    if (this.deleteFavorites.checked) items.push('le fichier des favoris (favorites.ini)');
                }
                if (!items.length) { return true; }
                return confirm('Supprimer definitivement ' + items.join(', ') + ' ? Cette action est irreversible.');
            ">
                <input type="hidden" name="zone" value="mame">
                <label class="checkbox-row">
                    <input type="checkbox" name="deleteHiscores">
                    <span>Supprimer les hiscores (<code>${escapeHtml(getHiscorePath(mameInfo.iniPath))}</code>)</span>
                </label>
                <label class="checkbox-row">
                    <input type="checkbox" name="deleteGamesMedia">
                    <span>Supprimer les roms et médias des jeux (roms, marquees, flyers, logos)</span>
                </label>
                <label class="checkbox-row">
                    <input type="checkbox" name="deleteFavorites"${mameInfo.favoritesPath ? '' : ' disabled'}>
                    <span>Supprimer le fichier des favoris${mameInfo.favoritesPath
                        ? ` (<code>${escapeHtml(mameInfo.favoritesPath)}</code>)`
                        : ' (aucun favorites.ini pour l\'instant)'}</span>
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
                            Supprimer tout le répertoire <code>${escapeHtml(mameInfo.iniPath)}</code>
                            <span class="checkbox-row-detail">Englobe les options ci-dessus, plus la
                            configuration mame.ini/ui.ini elle-même, cfg, nvram, snapshots... - MAME
                            la recréera au prochain lancement.</span>
                        </span>
                </label>
                <button type="submit">Supprimer la sélection</button>
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
            <h2>Périphériques détectés (sondage MAME)</h2>
            <p class="info">Lance une rom en arrière-plan (sans vidéo ni son) juste pour demander à
            MAME quels joysticks/manettes il détecte actuellement, et sous quel nom/token
            (<code>JOYCODE_&lt;n&gt;_&lt;token&gt;</code>) chacun de leurs boutons/axes est
            reconnu.</p>
            ${state?.error ? `<p class="error flash">${escapeHtml(state.error)}</p>` : ''}
            <form method="post" action="/input-probe/devices">
                <button type="submit">Détecter les manettes</button>
            </form>
            ${state?.result ? (rows ? `
                <div class="table-wrap">
                    <table class="favorites-table">
                        <thead><tr><th>Périphérique</th><th>ID</th><th>Boutons/axes</th></tr></thead>
                        <tbody>${rows}</tbody>
                    </table>
                </div>
            ` : '<p class="info flash">Aucun périphérique joystick détecté.</p>') : ''}
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
 * Global (default.cfg, not per-game) remap actions offered on the Manettes tab, grouped for
 * display. Grows over time (see renderRemapCard()'s own comment) - starts with just enough to
 * make the cabinet joystick-only usable: quitting a game, and P1's coin/start (the two inputs
 * every driver needs before its own P1 directions/buttons even come into play).
 */
const REMAP_GROUPS: { title: string; actions: RemapAction[] }[] = [
    {title: 'Système', actions: [
        {portType: 'UI_CANCEL', label: 'Quitter MAME'},
    ]},
    {title: 'Joueur 1', actions: [
        {portType: 'COIN1', label: 'Insérer une pièce'},
        {portType: 'START1', label: 'Start'},
        {portType: 'P1_JOYSTICK_UP', label: 'Haut'},
        {portType: 'P1_JOYSTICK_RIGHT', label: 'Droite'},
        {portType: 'P1_JOYSTICK_DOWN', label: 'Bas'},
        {portType: 'P1_JOYSTICK_LEFT', label: 'Gauche'},
        {portType: 'P1_BUTTON1', label: 'Bouton 1'},
        {portType: 'P1_BUTTON2', label: 'Bouton 2'},
        {portType: 'P1_BUTTON3', label: 'Bouton 3'},
        {portType: 'P1_BUTTON4', label: 'Bouton 4'},
        {portType: 'P1_BUTTON5', label: 'Bouton 5'},
        {portType: 'P1_BUTTON6', label: 'Bouton 6'},
        {portType: 'P1_BUTTON7', label: 'Bouton 7'},
        {portType: 'P1_BUTTON8', label: 'Bouton 8'},
    ]},
    {title: 'Joueur 2', actions: [
        {portType: 'COIN2', label: 'Insérer une pièce'},
        {portType: 'START2', label: 'Start'},
        {portType: 'P2_JOYSTICK_UP', label: 'Haut'},
        {portType: 'P2_JOYSTICK_RIGHT', label: 'Droite'},
        {portType: 'P2_JOYSTICK_DOWN', label: 'Bas'},
        {portType: 'P2_JOYSTICK_LEFT', label: 'Gauche'},
        {portType: 'P2_BUTTON1', label: 'Bouton 1'},
        {portType: 'P2_BUTTON2', label: 'Bouton 2'},
        {portType: 'P2_BUTTON3', label: 'Bouton 3'},
        {portType: 'P2_BUTTON4', label: 'Bouton 4'},
        {portType: 'P2_BUTTON5', label: 'Bouton 5'},
        {portType: 'P2_BUTTON6', label: 'Bouton 6'},
        {portType: 'P2_BUTTON7', label: 'Bouton 7'},
        {portType: 'P2_BUTTON8', label: 'Bouton 8'},
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
// the Manettes tab (see startMameConfigSession()/stopMameConfigSession()/captureOnePress() below) -
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
    UI_MENU: 'le menu de configuration de MAME (touche Tab)',
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
                <td>${currentToken ? `<code>${escapeHtml(currentToken)}</code>` : '<em>non assigné</em>'}</td>
                <td class="center">
                    <form method="post" action="/input-probe/remap">
                        <input type="hidden" name="portType" value="${escapeHtml(action.portType)}">
                        <button type="submit">Capturer un appui</button>
                    </form>
                </td>
            </tr>
            ${actionState?.error ? `
                <tr><td colspan="3"><p class="error flash">${escapeHtml(actionState.error)}</p></td></tr>
            ` : ''}
            ${actionState?.releasedFrom?.length ? `
                <tr><td colspan="3"><p class="info flash">Ce bouton était aussi lié par défaut à
                ${escapeHtml(actionState.releasedFrom.map(port => UI_PORT_LABELS[port] ?? port).join(', '))} dans
                MAME - il en a été retiré pour éviter un double déclenchement.</p></td></tr>
            ` : ''}
        `;
    }).join('');

    const sessionRunning = isMameConfigSessionAlive();

    return `
        <section class="card">
            <h2>Configuration globale des entrées</h2>
            <p class="info">Associe un bouton de la manette à une commande. <strong>1.</strong>
            Lance MAME ci-dessous (une vraie fenêtre, pas en arrière-plan) et laisse-le ouvert
            pendant toute la configuration - toutes les captures partagent ainsi le même
            démarrage, donc les mêmes index de manette du début à la fin.
            <strong>2.</strong> Clique sur "Capturer un appui" pour la commande voulue, puis
            <strong>donne le focus à la fenêtre MAME</strong> (clique dedans) et appuie sur le
            bouton dans les 30 secondes - MAME ne reçoit les manettes que lorsqu'il est au premier
            plan. <strong>3.</strong> Ferme MAME une fois terminé. Le résultat est écrit
            directement dans <code>default.cfg</code> (valable pour tous les jeux, sauf override
            propre à un jeu précis). <strong>Actuellement</strong> reflète ce qui est vraiment
            enregistré dans le fichier, pas seulement la dernière capture.</p>
            <p><strong>MAME :</strong> ${sessionRunning ? 'lancé' : 'fermé'}</p>
            <form method="post" action="/input-probe/mame/${sessionRunning ? 'stop' : 'start'}">
                <button type="submit">${sessionRunning ? 'Fermer MAME' : 'Lancer MAME'}</button>
            </form>
            ${REMAP_GROUPS.map(group => `
                <h3>${escapeHtml(group.title)}</h3>
                <div class="table-wrap">
                    <table class="favorites-table">
                        <thead>
                            <tr><th>Commande</th><th>Actuellement</th><th class="center"></th></tr>
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
    const directions: { [key: string]: string } = {Up: 'Haut', Down: 'Bas', Left: 'Gauche', Right: 'Droite'};
    if (directions[suffix]) {
        return directions[suffix];
    }
    const buttonMatch = /^Button (\d+)$/.exec(suffix);
    return buttonMatch ? `Bouton ${buttonMatch[1]}` : suffix;
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
                <h2>Touches et manettes (sondage MAME)</h2>
                <p class="info flash">Aucune rom trouvée dans le dossier des roms - importez un starting
                pack ou déposez au moins un fichier .zip dans ce dossier pour pouvoir sonder une
                configuration d'entrées.</p>
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
            <h3>Joueur ${player}</h3>
            ${rows ? `
                <div class="table-wrap">
                    <table class="favorites-table">
                        <thead><tr><th>Commande</th><th>Défaut</th><th>Actuel</th></tr></thead>
                        <tbody>${rows}</tbody>
                    </table>
                </div>
            ` : '<p class="info flash">Aucune association trouvée pour ce joueur.</p>'}
        `;
    };

    return `
        <section class="card">
            <h2>Touches et manettes (sondage MAME)</h2>
            <p class="info">Lance la rom sélectionnée en arrière-plan (sans vidéo ni son) pour
            demander à MAME lui-même sa configuration d'entrées P1/P2 (stick directionnel,
            boutons, start et coin) - <strong>Défaut</strong> est la valeur d'origine de MAME,
            <strong>Actuel</strong> est la valeur effective une fois les réglages globaux et
            propres à ce jeu appliqués (en <strong>gras</strong> quand elle diffère du défaut).
            <code>KEYCODE_*</code> = touche clavier, <code>JOYCODE_&lt;n&gt;_*</code> = manette
            n° n ; plusieurs associations peuvent être combinées avec OR/AND/NOT.</p>
            ${state?.error ? `<p class="error flash">${escapeHtml(state.error)}</p>` : ''}
            <form method="post" action="/input-probe">
                <label for="probeRomName">Rom</label>
                <select id="probeRomName" name="romName">${options}</select>
                <button type="submit">Sonder</button>
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
            <h2>Zone dangereuse</h2>
            <p class="error">Suppressions ciblées et irréversibles, portant sur mame-awesome-ui
            lui-même. Chaque case agit indépendamment des autres - cochez ce que vous voulez
            supprimer puis validez. Supprimer la configuration ou la base de données ferme
            l'application ensuite ; il faudra la relancer manuellement (<code>just serve</code>
            en développement) pour terminer l'opération.</p>
            ${info ? `<p class="info flash">${escapeHtml(info)}</p>` : ''}
            <form method="post" action="/reset" onsubmit="
                var items = [];
                if (this.deleteConfig.checked) items.push('la configuration de mame-awesome-ui');
                if (this.deleteDatabase.checked) items.push('la base de donnees (jeux, joueurs, scores)');
                if (!items.length) { return true; }
                return confirm('Supprimer definitivement ' + items.join(', ') + ' ? Cette action est irreversible.');
            ">
                <input type="hidden" name="zone" value="maui">
                <label class="checkbox-row">
                    <input type="checkbox" name="deleteConfig">
                    Supprimer la configuration de mame-awesome-ui (mame-awesome-ui-config.json)
                </label>
                <label class="checkbox-row">
                    <input type="checkbox" name="deleteDatabase">
                    Supprimer la base de données (jeux, joueurs, scores)
                </label>
                <button type="submit">Supprimer la sélection</button>
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
                id: 'manettes',
                label: 'Manettes',
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
                id: 'depot',
                label: 'Dépôt',
                html: renderRepoImportCard(config, repoPacks, repoError, repoInfo),
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
        : (repoError !== undefined || repoInfo !== undefined || repoPacks !== undefined) ? 'depot'
            : importError !== undefined ? 'import'
                : (inputProbeState !== undefined || deviceProbeState !== undefined || remapState !== undefined) ? 'manettes'
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

function getSquashfsRootPath(): string {
    return join(os.homedir(), 'squashfs-root');
}

// Mirrors the dedicated-system layout documented in docs/RASPBERRY-PI-DEPLOY.md §5.3/§7: the
// AppImage extracted once into a fixed ~/squashfs-root, referenced by path from ~/.xinitrc. Ruled
// out in development (NODE_ENV) so this never fires from a repo checkout that happens to also
// have a stray ~/squashfs-root from a real install on the same machine.
function isSelfUpdateCapable(): boolean {
    return process.platform === 'linux' && process.env.NODE_ENV !== 'development'
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
 * Computes everything the "Mise à jour" subtab needs to render: the public releases list (any
 * BO role can see/install those), split into real releases and develop prereleases (the latter
 * only rendered for admins, see renderUpdateCard()). Called by every route that (re-)renders
 * the MAUI page, same as getMameInfo() is recomputed fresh by every route touching the MAME tab.
 */
async function getUpdateInfo(): Promise<UpdateInfo> {
    const info: UpdateInfo = {
        capable: isSelfUpdateCapable(),
        currentVersion: electronApp.getVersion(),
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
        info.releases = entries.filter(entry => !entry.isPrerelease);
        info.devBuilds = entries.filter(entry => entry.isPrerelease);
    } catch (error) {
        info.releasesError = error instanceof Error ? error.message : 'erreur inattendue';
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
    res.write(`<section class="card"><h2>${escapeHtml(title)}</h2><ul class="progress-log">`);
    const writeLine = (line: string): void => {
        res.write(`<li>${escapeHtml(line)}</li>`);
    };

    const squashfsRoot = getSquashfsRootPath();
    // Next to ~/squashfs-root, not in os.tmpdir(): /tmp is a separate tmpfs on Debian/Raspberry Pi
    // OS, and renameSync() across devices fails with EXDEV - which used to happen *after* the
    // current install had already been moved to .old, leaving no ~/squashfs-root at all.
    const workDir = mkdtempSync(join(dirname(squashfsRoot), '.mame-awesome-ui-update-'));
    try {
        writeLine('Téléchargement en cours…');
        const response = await fetch(downloadUrl);
        if (!response.ok || !response.body) {
            throw new Error(`Téléchargement échoué (HTTP ${response.status}).`);
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
                        writeLine(totalMb ? `Téléchargé : ${mb} Mo / ${totalMb} Mo` : `Téléchargé : ${mb} Mo`);
                    }
                    callback(null, chunk);
                },
            }),
            createWriteStream(appImagePath),
        );

        chmodSync(appImagePath, 0o755);

        writeLine('Extraction de l\'AppImage…');
        execFileSync(appImagePath, ['--appimage-extract'], {cwd: workDir, stdio: ['ignore', 'pipe', 'pipe']});

        const newSquashfsRoot = join(workDir, 'squashfs-root');
        if (!existsSync(newSquashfsRoot)) {
            throw new Error('Extraction terminée mais squashfs-root introuvable dans l\'AppImage.');
        }

        const oldSquashfsRoot = `${squashfsRoot}.old`;
        // The previous .old is parked in workDir (deleted with it in finally) rather than removed
        // up front, so it can be put back if the swap fails.
        const parkedOldSquashfsRoot = join(workDir, 'previous.old');
        writeLine('Bascule vers la nouvelle version…');
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
            'Mise à jour installée. Redémarrez le Pi (ou "sudo systemctl restart getty@tty1") '
            + 'pour appliquer la nouvelle version. L\'ancienne version reste disponible dans '
            + '~/squashfs-root.old le temps de valider la nouvelle.',
        );
    } catch (error) {
        const message = error instanceof Error ? error.message : 'erreur inattendue';
        writeLine(`Échec : ${message}`);
    } finally {
        rmSync(workDir, {recursive: true, force: true});
    }

    res.write('</ul></section>');
}

function renderUpdateReleaseRow(release: UpdateReleaseEntry, capable: boolean, confirmLabel: string): string {
    return `
        <tr>
            <td>${escapeHtml(release.name)}${release.isCurrent ? ' <span class="badge-yes">version actuelle</span>' : ''}</td>
            <td>${escapeHtml(new Date(release.publishedAt).toLocaleDateString('fr-FR'))}</td>
            <td class="center">
                ${release.assetUrl && !release.isCurrent ? `
                    <form method="post" action="/maui/update/install"
                        onsubmit="return confirm('${confirmLabel.replace('{tag}', escapeHtml(release.tagName))}')">
                        <input type="hidden" name="tagName" value="${escapeHtml(release.tagName)}">
                        <input type="hidden" name="assetUrl" value="${escapeHtml(release.assetUrl)}">
                        <button type="submit" ${capable ? '' : 'disabled'}>Installer</button>
                    </form>
                ` : release.isCurrent ? '' : '<em>Aucun artefact pour cette plateforme</em>'}
            </td>
        </tr>
    `;
}

function renderUpdateCard(
    updateInfo: UpdateInfo, isAdmin: boolean, installMessage?: string, installError?: string,
): string {
    const confirmRelease = 'Installer la version {tag} ? Le Pi devra ensuite etre redemarre.';
    const releaseRows = updateInfo.releases
        .map(release => renderUpdateReleaseRow(release, updateInfo.capable, confirmRelease))
        .join('');

    const confirmDevBuild = 'Installer le build de developpement {tag} (non promu vers main) ? '
        + 'Le Pi devra ensuite etre redemarre.';
    const devBuildRows = updateInfo.devBuilds
        .map(release => renderUpdateReleaseRow(release, updateInfo.capable, confirmDevBuild))
        .join('');

    return `
        <section class="card">
            <h2>Mise à jour</h2>
            <p class="info">Version actuellement installée : <strong>${escapeHtml(updateInfo.currentVersion)}</strong></p>
            ${!updateInfo.capable ? `
                <p class="error">Installation automatique indisponible sur cette machine (attendu :
                Linux, hors développement, AppImage extraite dans ~/squashfs-root - voir
                docs/RASPBERRY-PI-DEPLOY.md). Les releases restent consultables ci-dessous.</p>
            ` : ''}
            ${installError ? `<p class="error flash">${escapeHtml(installError)}</p>` : ''}
            ${installMessage ? `<p class="info flash">${escapeHtml(installMessage)}</p>` : ''}
            ${updateInfo.releasesError
                ? `<p class="error">Impossible de récupérer les releases GitHub : ${escapeHtml(updateInfo.releasesError)}</p>`
                : `<table>
                    <thead><tr><th>Version</th><th>Publiée le</th><th></th></tr></thead>
                    <tbody>${releaseRows || '<tr><td colspan="3"><em>Aucune release trouvée.</em></td></tr>'}</tbody>
                </table>`}
        </section>
        ${isAdmin ? `
            <section class="card">
                <h2>Builds de développement (non publiés)</h2>
                <p class="error">Prereleases GitHub générées automatiquement à chaque push sur
                develop (workflow "Build") - pas encore promues vers main, à réserver aux tests.</p>
                ${!updateInfo.releasesError
                    ? `<table>
                        <thead><tr><th>Version</th><th>Publiée le</th><th></th></tr></thead>
                        <tbody>${devBuildRows || '<tr><td colspan="3"><em>Aucun build disponible.</em></td></tr>'}</tbody>
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
                    Afficher en plein écran (décoché = fenêtré)
                </label>
                <label class="checkbox-row">
                    <input type="checkbox" name="openDevTools" ${config.openDevTools ? 'checked' : ''}>
                    Ouvrir les DevTools au démarrage (mode développement)
                </label>
                <button type="submit">Enregistrer</button>
            </form>
        </section>
    `;
}

function renderMauiImportExportCard(error?: string, info?: string): string {
    return `
        <section class="card">
            <h2>Import / export mame-awesome-ui</h2>
            <p class="info">Sauvegarde ou restaure la configuration
            (mame-awesome-ui-config.json) et/ou la base de données (jeux, joueurs, scores)
            de mame-awesome-ui - pas les roms ni les données de mame lui-même.</p>
            ${error ? `<p class="error flash">${escapeHtml(error)}</p>` : ''}
            ${info ? `<p class="info flash">${escapeHtml(info)}</p>` : ''}
            <form method="get" action="/maui/export">
                <label class="checkbox-row">
                    <input type="checkbox" name="json" checked>
                    Configuration (JSON)
                </label>
                <label class="checkbox-row">
                    <input type="checkbox" name="db">
                    Base de données (DB)
                </label>
                <button type="submit">Exporter</button>
            </form>
            <form method="post" action="/maui/import" enctype="multipart/form-data"
                onsubmit="return confirm('Ecraser la configuration et/ou la base de donnees actuelle avec ce fichier ? Cette action est irreversible.')">
                <label for="mauiImportFile">Fichier à importer (.json, .sqlite/.db, ou .zip contenant les deux)</label>
                <input type="file" id="mauiImportFile" name="file" accept=".json,.sqlite,.db,.zip" required>
                <button type="submit">Importer</button>
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
        : '<em>aucune entrée</em>';

    const renderLongPress = (ms?: number): string => ms === undefined ? '' : ` <em>appui long (${ms / 1000} s)</em>`;

    const contextTables = MAUI_CONTROL_CONTEXTS.map(context => `
        <h3>${escapeHtml(context.title)}</h3>
        <div class="table-wrap">
            <table class="favorites-table">
                <thead>
                    <tr><th>Touche</th><th>Rôle</th><th>Manette (disposition standard)</th></tr>
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
            <summary>Manettes avec une disposition propre (${specificPads.length})</summary>
            ${specificPads.map(([name, mapping]) => `
                <h3>${escapeHtml(name)}</h3>
                <div class="table-wrap">
                    <table class="favorites-table">
                        <thead><tr><th>Touche</th><th>Entrées de la manette</th></tr></thead>
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
            <h2>Contrôles de MAUI</h2>
            <p class="info">Les touches que l'interface de la borne comprend, avec leur rôle. Les
            mêmes touches n'ont pas le même rôle selon l'écran. Une manette produit ces touches via
            <code>controllers.json</code> : une entrée <em>aucune entrée</em> veut dire que la
            commande n'est accessible qu'au clavier avec cette disposition. Distinct de l'onglet MAME
            &gt; Manettes, qui règle les entrées de MAME (dans les jeux) et non celles de MAUI.</p>
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
        {id: 'general', label: 'Général', html: renderMauiCard(config, messages.mauiInfo)},
        {id: 'controles', label: 'Contrôles', html: renderMauiControlsCard()},
    ];
    if (updateInfo) {
        sections.push({
            id: 'update',
            label: 'Mise à jour',
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
            <p>Identifiants utilisés pour récupérer marquees, flyers et autres visuels depuis
            <a href="https://www.screenscraper.fr" target="_blank" rel="noopener">screenscraper.fr</a>.</p>
            ${error ? `<p class="error flash">${escapeHtml(error)}</p>` : ''}
            ${info ? `<p class="info flash">${escapeHtml(info)}</p>` : ''}
            <form method="post" action="/screenscraper/save" novalidate>
                <label for="ssUserId">Identifiant utilisateur (ssid)</label>
                <input type="text" id="ssUserId" name="ssUserId" value="${escapeHtml(values.ssUserId)}" autocomplete="off">
                <label for="ssUserPassword">Mot de passe utilisateur (sspassword)</label>
                <input type="password" id="ssUserPassword" name="ssUserPassword" value="${escapeHtml(values.ssUserPassword)}" autocomplete="off">

                <label for="ssSoftName">Nom du logiciel (softname)</label>
                <input type="text" id="ssSoftName" name="ssSoftName" value="${escapeHtml(values.ssSoftName)}" autocomplete="off">
                <label for="ssDevId">Identifiant développeur (devid) — à créer sur screenscraper.fr, aucune valeur par défaut n'est fournie par l'application</label>
                <input type="text" id="ssDevId" name="ssDevId" value="${escapeHtml(values.ssDevId)}" autocomplete="off">
                <label for="ssDevPassword">Mot de passe développeur (devpassword)</label>
                <input type="password" id="ssDevPassword" name="ssDevPassword" value="${escapeHtml(values.ssDevPassword)}" autocomplete="off">

                <label for="bezelAspect">Format des bezels (aspect_ratio de l'écran cible)</label>
                <select id="bezelAspect" name="bezelAspect">
                    <option value="16:9" ${values.bezelAspect === '16:9' ? 'selected' : ''}>16:9 (écran large)</option>
                    <option value="4:3" ${values.bezelAspect === '4:3' ? 'selected' : ''}>4:3 (écran classique)</option>
                </select>
                <button type="submit">Enregistrer</button>
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
                <h2>Récupération des médias</h2>
                <p class="error flash">Identifiants ScreenScraper manquants : renseignez-les (onglet
                Identifiants) avant de lancer un téléchargement.</p>
            </section>
        `;
    }
    return `
        <section class="card">
            <h2>Récupération des médias</h2>
            ${error ? `<p class="error flash">${escapeHtml(error)}</p>` : ''}
            ${summary ? renderDownloadSummary(summary) : ''}
            <form method="post" action="/favorites/download-media">
                <p class="info">Télécharge les marquees/flyers/logos manquants depuis ScreenScraper pour tous
                les favoris. Traitement synchrone, peut prendre plusieurs minutes selon le nombre de favoris
                (délai imposé entre chaque appel) - ne fermez pas cette page pendant le téléchargement.</p>
                <button type="submit">Télécharger les visuels manquants</button>
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
    const defaultSubtab = (downloadError !== undefined || summary !== undefined) ? 'telechargement'
        : (error !== undefined || info !== undefined) ? 'identifiants'
            : undefined;
    return renderSubtabbedPage('screenscraper', [
        {id: 'identifiants', label: 'Identifiants', html: renderScreenScraperCard(values, error, info)},
        {
            id: 'telechargement',
            label: 'Téléchargement',
            html: renderScreenScraperDownloadCard(hasCreds, downloadError, summary),
        },
    ], true, defaultSubtab);
}

function renderFavoriteBadge(found: boolean): string {
    return found ? '<span class="badge-yes">✓</span>' : '<span class="badge-no">✗</span>';
}

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
        `${summary.alreadyComplete} déjà complet(s)`,
        `${summary.downloaded} fichier(s) téléchargé(s)`,
        `${summary.notFound} introuvable(s) sur ScreenScraper`,
        `${summary.noMedia} sans visuel disponible`,
        `${summary.errors.length} erreur(s)`,
    ];
    const errorsHtml = summary.errors.length
        ? `<ul>${summary.errors.map(error => `<li>${escapeHtml(error)}</li>`).join('')}</ul>`
        : '';
    return `
        <p class="info flash">${escapeHtml(parts.join(' — '))}${summary.stoppedForQuota
            ? ' — arrêté : quota ScreenScraper dépassé, réessayez plus tard.'
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
    if (favoritesInfo.error) {
        return `
            <section class="card">
                <h2>Favoris</h2>
                <p class="info">${escapeHtml(favoritesInfo.error)}</p>
            </section>
        `;
    }

    const rows = favoritesInfo.rows.map(row => `
        <tr>
            <td>${escapeHtml(row.romName)}</td>
            <td>${row.cached ? renderGameName(row.fullname) : `<em>${escapeHtml(row.romName)}</em>`}</td>
            <td>${renderBiosCell(row)}</td>
            <td class="center">${renderFavoriteBadge(row.hasMarquee)}</td>
            <td class="center">${renderFavoriteBadge(row.hasFlyer)}</td>
            <td class="center">${renderFavoriteBadge(row.hasLogo)}</td>
        </tr>
    `).join('');

    const unresolvedCount = favoritesInfo.rows.filter(row => !row.cached).length;
    const cacheStatus = favoritesInfo.cacheUpdatedAt
        ? `Noms à jour au ${escapeHtml(new Date(favoritesInfo.cacheUpdatedAt).toLocaleString('fr-FR', {
            dateStyle: 'short', timeStyle: 'short',
        }))}.`
        : 'Noms jamais mis à jour.';

    return `
        <section class="card">
            <h2>Favoris (${favoritesInfo.rows.length})</h2>
            <p class="info">${cacheStatus}${unresolvedCount
                ? ` ${unresolvedCount} favori(s) ajouté(s) depuis - pas encore résolu(s).`
                : ''}</p>
            <form method="post" action="/favorites/refresh">
                <button type="submit">Mettre à jour les favoris</button>
            </form>
            <div class="table-wrap">
                <table class="favorites-table">
                    <thead>
                        <tr>
                            <th>Shortname</th>
                            <th>Name</th>
                            <th>Bios / Devices</th>
                            <th class="center">Marquee</th>
                            <th class="center">Flyer</th>
                            <th class="center">Logo</th>
                        </tr>
                    </thead>
                    <tbody>${rows}</tbody>
                </table>
            </div>
            <p class="info">Pour télécharger les visuels manquants (marquees, flyers, logos) depuis
            ScreenScraper, utilisez le bouton de l'onglet <a href="/screenscraper">ScreenScraper</a>.</p>
        </section>
    `;
}

function renderFavoritesPage(favoritesInfo: FavoritesInfo): string {
    return renderPage(renderFavoritesCard(favoritesInfo), 'favorites');
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
    return '<p class="error flash">python3 introuvable sur cette machine - l\'import de starting pack '
        + 'est indisponible.</p>';
}

function renderImportCard(error?: string): string {
    return `
        <section class="card">
            <h2>Importer un starting pack</h2>
            <p class="info">Remplace intégralement les jeux/roms/artwork/favoris présents dans
            le pack. Les autres jeux, joueurs et scores ne sont pas touchés.</p>
            <p class="info">Un ZIP peut aussi ne contenir que des dossiers ${IMPORTABLE_MAME_DIRECTORIES
                .map(d => escapeHtml(d.zipFolder)).join(', ')} (copiés tels quels dans la
            configuration mame courante) - dans ce cas, pas besoin de manifest.json.</p>
            ${error ? `<p class="error flash">${escapeHtml(error)}</p>` : ''}
            <form method="post" action="/import" enctype="multipart/form-data">
                <label for="pack">Fichier ZIP</label>
                <input type="file" id="pack" name="pack" accept=".zip" required>
                <button type="submit">Importer</button>
            </form>
        </section>
    `;
}

function humanFileSize(bytes: number): string {
    let size = bytes;
    for (const unit of ['o', 'Kio', 'Mio', 'Gio']) {
        if (size < 1024) {
            return `${size.toFixed(1)} ${unit}`;
        }
        size /= 1024;
    }
    return `${size.toFixed(1)} Tio`;
}

function renderRepoPackPicker(packs: RepoPack[]): string {
    if (!packs.length) {
        return '<p class="info flash">Aucun pack disponible sur ce dépôt.</p>';
    }
    const options = packs.map(pack => {
        const details = [
            humanFileSize(pack.size),
            pack.gameCount !== undefined ? `${pack.gameCount} jeu(x)` : null,
            pack.generatedAt ? new Date(pack.generatedAt).toLocaleDateString('fr-FR') : null,
        ].filter((part): part is string => part !== null).join(' — ');
        return `<option value="${escapeHtml(pack.filename)}">${escapeHtml(pack.filename)} (${escapeHtml(details)})</option>`;
    }).join('');
    return `
        <form method="post" action="/import/from-url"
            onsubmit="return confirm('Ceci écrase les roms/favoris/médias déjà présents pour les jeux du pack. Continuer ?')">
            <label for="packFilename">Pack à importer</label>
            <select id="packFilename" name="packFilename" required>${options}</select>
            <button type="submit">Télécharger et importer</button>
        </form>
    `;
}

/**
 * Settings form (POST /repo/save) for repo.maui.afronob.com's basic-auth credentials, plus -
 * once repoUrl is set - a button to browse it (GET /import/from-url/packs) and, once packs have
 * been fetched, the picker itself. Admin-only, same gating as renderMameDangerZoneCard() (see
 * renderForm()): downloading and importing an arbitrary pack from a configured repo is no less
 * consequential than the manual upload form right above it.
 */
function renderRepoImportCard(config: Config, packs?: RepoPack[], error?: string, info?: string): string {
    return `
        <section class="card">
            <h2>Dépôt de starting packs</h2>
            <p class="info">Parcourt et importe un starting pack directement depuis un dépôt HTTP
            protégé par mot de passe (voir docs/STARTER-PACK-REPO.md), sans passer par l'upload
            (onglet Import) - utile pour un pack trop volumineux pour un formulaire navigateur.</p>
            ${error ? `<p class="error flash">${escapeHtml(error)}</p>` : ''}
            ${info ? `<p class="info flash">${escapeHtml(info)}</p>` : ''}
            <form method="post" action="/repo/save" novalidate>
                <label for="repoUrl">URL du dépôt</label>
                <input type="text" id="repoUrl" name="repoUrl" value="${escapeHtml(config.repoUrl)}"
                    placeholder="https://repo.maui.afronob.com" autocomplete="off">
                <label for="repoUser">Identifiant</label>
                <input type="text" id="repoUser" name="repoUser" value="${escapeHtml(config.repoUser)}" autocomplete="off">
                <label for="repoPassword">Mot de passe</label>
                <input type="password" id="repoPassword" name="repoPassword" value="${escapeHtml(config.repoPassword)}" autocomplete="off">
                <button type="submit">Enregistrer</button>
            </form>
            ${config.repoUrl ? `
                <form method="get" action="/import/from-url/packs">
                    <button type="submit">Parcourir les packs disponibles</button>
                </form>
                ${packs ? renderRepoPackPicker(packs) : ''}
            ` : ''}
        </section>
    `;
}

function renderUserStatusBadge(active: boolean): string {
    return active ? '<span class="badge-yes">✓ actif</span>' : '<span class="badge-no">✗ inactif</span>';
}

function renderCreateUserCard(error?: string): string {
    return `
        <section class="card">
            <h2>Ajouter un joueur</h2>
            ${error ? `<p class="error flash">${escapeHtml(error)}</p>` : ''}
            <form method="post" action="/users/create">
                <label for="pseudo_3">Pseudo 3 lettres (requis, unique)</label>
                <input type="text" id="pseudo_3" name="pseudo_3" maxlength="3" required>
                <label for="realname">Nom</label>
                <input type="text" id="realname" name="realname">
                <label for="email">Email</label>
                <input type="email" id="email" name="email">
                <label class="checkbox-row">
                    <input type="checkbox" name="active" checked>
                    Actif
                </label>
                <button type="submit">Créer</button>
            </form>
        </section>
    `;
}

function renderUsersListCard(users: User[], avatarFilenames: string[], error?: string, info?: string): string {
    const rows = users.map(user => {
        const avatarFilename = `${user.pseudo_3}.png`;
        const hasAvatar = avatarFilenames.indexOf(avatarFilename) >= 0;
        return `
        <tr>
            <td class="center">
                <form method="post" action="/users/${user.id_user}/avatar" enctype="multipart/form-data">
                    <label class="avatar-upload" title="Changer l'avatar (PNG)">
                        ${hasAvatar
                            ? `<img class="avatar-thumb" src="/avatars/${encodeURIComponent(avatarFilename)}" alt="">`
                            : '<span class="avatar-thumb avatar-placeholder">＋</span>'}
                        <input type="file" name="avatar" accept="image/png" onchange="this.form.submit()">
                    </label>
                </form>
            </td>
            <td>${escapeHtml(user.pseudo_3)}</td>
            <td>${user.realname ? escapeHtml(user.realname) : '<em>-</em>'}</td>
            <td class="center">${renderUserStatusBadge(user.active)}</td>
            <td class="center">
                <form method="post" action="/users/${user.id_user}/toggle-active">
                    <button type="submit">${user.active ? 'Désactiver' : 'Activer'}</button>
                </form>
            </td>
            <td class="center">
                <form method="post" action="/users/${user.id_user}/delete"
                    onsubmit="return confirm('Supprimer ${escapeHtml(user.pseudo_3)} ?')">
                    <button type="submit">Supprimer</button>
                </form>
            </td>
        </tr>
    `;
    }).join('');

    return `
        <section class="card">
            <h2>Joueurs (${users.length})</h2>
            ${error ? `<p class="error flash">${escapeHtml(error)}</p>` : ''}
            ${info ? `<p class="info flash">${escapeHtml(info)}</p>` : ''}
            <div class="table-wrap">
                <table class="favorites-table">
                    <thead>
                        <tr>
                            <th class="center">Avatar</th>
                            <th>Pseudo</th>
                            <th>Nom</th>
                            <th class="center">Statut</th>
                            <th class="center"></th>
                            <th class="center"></th>
                        </tr>
                    </thead>
                    <tbody>${rows || '<tr><td colspan="6"><em>Aucun joueur</em></td></tr>'}</tbody>
                </table>
            </div>
        </section>
    `;
}

function renderUsersPage(
    users: User[], avatarFilenames: string[], error?: string, info?: string, createError?: string,
): string {
    // See renderForm()'s own defaultSubtab for why this is computed from which message was
    // actually passed for this response, not inferred client-side from scanning for .flash.
    // createError is kept separate from error/info (both list-card messages, e.g. from
    // toggle-active/delete/avatar upload) so a duplicate-pseudo error from /users/create lands
    // back on "Ajouter", next to the form that produced it, instead of "Joueurs".
    const defaultSubtab = createError !== undefined ? 'ajouter'
        : (error !== undefined || info !== undefined) ? 'joueurs'
            : undefined;
    return renderSubtabbedPage('users', [
        {id: 'ajouter', label: 'Ajouter', html: renderCreateUserCard(createError)},
        {id: 'joueurs', label: 'Joueurs', html: renderUsersListCard(users, avatarFilenames, error, info)},
    ], true, defaultSubtab);
}

/**
 * Friendly message for the common User.create() failure modes (unique pseudo_3,
 * length validators) instead of a raw Sequelize error dump.
 */
function describeUserError(error: unknown): string {
    if (error instanceof UniqueConstraintError) {
        return 'Un joueur avec ce pseudo existe déjà.';
    }
    if (error instanceof ValidationError) {
        return error.errors.map(e => e.message).join(' ');
    }
    return error instanceof Error ? error.message : 'Erreur inattendue.';
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
        error = `Impossible de lire le dossier "${currentDir}".`;
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
            <h2>Choisir un dossier</h2>
            <p class="current-path">${escapeHtml(currentDir)}</p>
            ${error ? `<p class="error flash">${escapeHtml(error)}</p>` : ''}
            <p>
                <a class="button-link" href="${selectLink(currentDir)}">Choisir ce dossier</a>
                ${canGoUp ? ` &nbsp; <a href="${navLink(parentDir)}">⬆ Dossier parent</a>` : ''}
            </p>
            <ul class="browse-list">${rows || '<li><em>Aucun sous-dossier</em></li>'}</ul>
            <p><a href="/?${carryQuery}">Annuler</a></p>
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
        res.sendFile(join(getStaticPath(), 'img/background.jpg'));
    });

    app.get('/mame-logo.svg', (req, res) => {
        res.sendFile(join(getStaticPath(), 'img/mame-logo.svg'));
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
                'Base de données pas encore initialisée - lancez l\'application une première fois avant de vous connecter.',
            ));
            return;
        }
        if (!boUser || !bcrypt.compareSync(password, boUser.passwordHash)) {
            res.status(401).send(renderLoginPage('Identifiant ou mot de passe incorrect.'));
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
            res.status(401).send(renderAccountPage(boUser.username, boUser.role, 'Mot de passe actuel incorrect.'));
            return;
        }
        if (newPassword.length < 4) {
            res.status(422).send(renderAccountPage(
                boUser.username, boUser.role, 'Le nouveau mot de passe doit contenir au moins 4 caractères.',
            ));
            return;
        }
        if (newPassword !== confirmPassword) {
            res.status(422).send(renderAccountPage(
                boUser.username, boUser.role, 'La confirmation ne correspond pas au nouveau mot de passe.',
            ));
            return;
        }

        boUser.passwordHash = bcrypt.hashSync(newPassword, 10);
        await boUser.save();
        res.send(renderAccountPage(boUser.username, boUser.role, undefined, 'Mot de passe mis à jour.'));
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

    app.get('/favorites', (req, res) => {
        const config = new Config();
        config.load();
        const context = getFavoritesContext(config);

        if ('error' in context) {
            res.send(renderFavoritesPage({rows: [], error: context.error}));
            return;
        }

        // Reads names/BIOS from the favorites cache instead of resolving them live (each favorite
        // otherwise costs a blocking `mame -lx` process spawn - see resolveFavoriteRow()), so this
        // tab loads instantly regardless of favorites count. Media badges stay live either way
        // (getFavoriteMediaStatus() is a cheap fs check). See POST /favorites/refresh below for
        // the button that re-resolves everything and rewrites the cache.
        const cache = readFavoritesCache();
        const rows = context.romNames.map(romName => favoriteRowFromCache(context, romName, cache));
        res.send(renderFavoritesPage({rows, cacheUpdatedAt: cache?.updatedAt ?? null}));
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
                <h2>Mise à jour des favoris (${context.romNames.length})…</h2>
                <ul class="progress-log">
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

    app.get('/users', async (req, res) => {
        const avatarFilenames = getAvatarFilenames(new Config());
        try {
            const users = await User.findAll({order: [['pseudo_3', 'ASC']]});
            res.send(renderUsersPage(users, avatarFilenames));
        } catch {
            res.send(renderUsersPage([], avatarFilenames, 'Base de données introuvable ou pas encore initialisée - '
                + 'lancez l\'application une première fois avant de gérer les joueurs.'));
        }
    });

    app.post('/users/create', async (req, res) => {
        const pseudo3: string = (req.body.pseudo_3 || '').trim().toUpperCase();
        const realname: string = (req.body.realname || '').trim();
        const email: string = (req.body.email || '').trim();
        const active = req.body.active === 'on';
        const avatarFilenames = getAvatarFilenames(new Config());

        try {
            await User.create({
                pseudo_3: pseudo3,
                ...(realname ? {realname} : {}),
                ...(email ? {email} : {}),
                active,
            } as User);
            const users = await User.findAll({order: [['pseudo_3', 'ASC']]});
            res.send(renderUsersPage(users, avatarFilenames, undefined, `Joueur "${pseudo3}" créé.`));
        } catch (error) {
            const users = await User.findAll({order: [['pseudo_3', 'ASC']]}).catch(() => []);
            res.status(422).send(renderUsersPage(
                users, avatarFilenames, undefined, undefined, describeUserError(error),
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
        res.send(renderUsersPage(
            users, getAvatarFilenames(new Config()), undefined,
            user ? `Joueur "${user.pseudo_3}" mis à jour.` : undefined,
        ));
    });

    app.post('/users/:id/delete', async (req, res) => {
        const user = await User.findByPk(req.params.id);
        if (user) {
            await user.destroy();
        }
        const users = await User.findAll({order: [['pseudo_3', 'ASC']]});
        res.send(renderUsersPage(
            users, getAvatarFilenames(new Config()), undefined,
            user ? `Joueur "${user.pseudo_3}" supprimé.` : undefined,
        ));
    });

    app.post('/users/:id/avatar', avatarUpload.single('avatar'), async (req, res) => {
        const user = await User.findByPk(req.params.id);
        const users = await User.findAll({order: [['pseudo_3', 'ASC']]}).catch(() => []);
        const config = new Config();

        if (!user) {
            res.status(404).send(renderUsersPage(users, getAvatarFilenames(config), 'Joueur introuvable.'));
            return;
        }
        if (!req.file) {
            res.status(422).send(
                renderUsersPage(users, getAvatarFilenames(config), 'Aucun fichier envoyé.'),
            );
            return;
        }
        if (req.file.mimetype !== 'image/png') {
            res.status(422).send(renderUsersPage(
                users, getAvatarFilenames(config), 'L\'avatar doit être une image PNG.',
            ));
            return;
        }

        writeFileSync(join(config.avatarsPath, `${user.pseudo_3}.png`), req.file.buffer);
        res.send(renderUsersPage(
            users, getAvatarFilenames(config), undefined, `Avatar mis à jour pour "${user.pseudo_3}".`,
        ));
    });

    app.get('/avatars/:filename', (req, res) => {
        const config = new Config();
        // basename() strips any directory components (e.g. "../../etc/passwd") from the
        // user-controlled route param before it ever reaches the filesystem.
        const filePath = join(config.avatarsPath, basename(req.params.filename));
        if (!existsSync(filePath)) {
            res.status(404).end();
            return;
        }
        res.sendFile(filePath);
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
                'Dossiers marquees/flyers/logos introuvables - configurez et validez le binaire mame '
                    + '(onglet MAME > Config).',
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
                <h2>Téléchargement en cours…</h2>
                <ul class="progress-log">
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
                escapeHtml(error instanceof Error ? error.message : 'Erreur inattendue.')
            }</p>`);
        }

        res.write('<p><a class="button-link" href="/screenscraper">Retour à ScreenScraper</a></p>');
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
                values, getMameInfo(config), isAdmin, undefined, undefined, undefined, 'Aucun fichier reçu.',
            ));
            return;
        }

        // A clear BO-rendered error instead of a raw ENOENT surfacing from spawn() below - macOS
        // in particular doesn't always ship a working python3 without Xcode CLT installed.
        if (!isPython3Available()) {
            rmSync(req.file.path, {force: true});
            res.status(500).send(renderForm(
                values, getMameInfo(config), isAdmin, undefined, undefined, undefined,
                'python3 introuvable sur cette machine - impossible d\'importer un starting pack.',
            ));
            return;
        }

        res.writeHead(200, {'Content-Type': 'text/html; charset=utf-8'});
        res.socket?.setNoDelay(true);
        res.write(renderPageHead('mame'));

        // Validation (manifest.json/IMPORTABLE_MAME_DIRECTORIES, MAME config completeness) and
        // the actual import both happen inside the script now - it mirrors this same logic and
        // reports failures through its own stdout/stderr lines, same as /import/from-url below.
        const started = await runImportScript(res, 'Import en cours…', [req.file.path], {...process.env});
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
            res.status(403).send('Action réservée aux administrateurs.');
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
            undefined, undefined, undefined, 'Configuration du dépôt enregistrée.',
        ));
    });

    // Proxied server-side (rather than the browser fetching index.json directly) so the repo's
    // basic-auth credentials never need to reach the browser at all.
    app.get('/import/from-url/packs', async (req, res) => {
        if (req.session.boRole !== 'admin') {
            res.status(403).send('Action réservée aux administrateurs.');
            return;
        }
        const config = new Config();
        config.load();
        const values: ConfigFormValues = {mamePath: config.mamePath || ''};
        const mameInfo = getMameInfo(config);

        if (!config.repoUrl) {
            res.status(422).send(renderForm(
                values, mameInfo, true, undefined, undefined, undefined, undefined, undefined, undefined,
                undefined, 'Renseignez l\'URL du dépôt avant de le parcourir.',
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
            res.send(renderForm(
                values, mameInfo, true, undefined, undefined, undefined, undefined, undefined, undefined,
                data.packs ?? [],
            ));
        } catch (error) {
            const message = error instanceof Error ? error.message : 'erreur inattendue';
            res.status(502).send(renderForm(
                values, mameInfo, true, undefined, undefined, undefined, undefined, undefined, undefined,
                undefined, `Impossible de contacter le dépôt : ${message}`,
            ));
        }
    });

    app.post('/import/from-url', async (req, res) => {
        if (req.session.boRole !== 'admin') {
            res.status(403).send('Action réservée aux administrateurs.');
            return;
        }
        const config = new Config();
        config.load();
        const values: ConfigFormValues = {mamePath: config.mamePath || ''};
        const mameInfo = getMameInfo(config);
        // Flows into a URL and a child-process argv below - restricted to a bare filename (no
        // path separators, no shell metacharacters) rather than trusting the <select> value.
        const packFilename = typeof req.body.packFilename === 'string' ? req.body.packFilename : '';

        if (!config.repoUrl) {
            res.status(422).send(renderForm(
                values, mameInfo, true, undefined, undefined, undefined, undefined, undefined, undefined,
                undefined, 'URL du dépôt non configurée.',
            ));
            return;
        }
        if (!/^[\w.-]+\.zip$/.test(packFilename)) {
            res.status(422).send(renderForm(
                values, mameInfo, true, undefined, undefined, undefined, undefined, undefined, undefined,
                undefined, 'Nom de pack invalide.',
            ));
            return;
        }
        // A clear BO-rendered error instead of a raw ENOENT surfacing from spawn() below -
        // macOS in particular doesn't always ship a working python3 without Xcode CLT installed.
        if (!isPython3Available()) {
            res.status(500).send(renderForm(
                values, mameInfo, true, undefined, undefined, undefined, undefined, undefined, undefined,
                undefined, 'python3 introuvable sur cette machine - impossible d\'importer depuis le dépôt.',
            ));
            return;
        }

        const packUrl = `${config.repoUrl}/${packFilename}`;

        res.writeHead(200, {'Content-Type': 'text/html; charset=utf-8'});
        res.socket?.setNoDelay(true);
        res.write(renderPageHead('mame'));

        // Credentials go through env, never argv, so they don't leak via `ps`/
        // `/proc/<pid>/cmdline` (they already sit in Config's plaintext JSON file at the same
        // trust level as ssDevPassword).
        const started = await runImportScript(
            res, `Import depuis le dépôt en cours… (${escapeHtml(packFilename)})`, ['--url', packUrl, '-y'],
            {...process.env, MAUI_REPO_USER: config.repoUser, MAUI_REPO_PASSWORD: config.repoPassword},
        );
        if (!started) {
            return;
        }

        const refreshedMameInfo = getMameInfo(config);
        res.write(renderConfigCard(values, req.session.boRole === 'admin'));
        res.write(renderMameInfoCard(refreshedMameInfo));
        if (!refreshedMameInfo.error) {
            res.write(renderPythonWarning());
            res.write(renderImportCard());
            res.write(renderRepoImportCard(config));
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
        await sendMauiPage(req, res, config, {mauiInfo: 'Configuration enregistrée.'});
    });

    // Backup/restore of mame-awesome-ui's own config/database - admin only (see the "Import /
    // export mame-awesome-ui" card, hidden from non-admins in renderMauiPage()).
    app.get('/maui/export', async (req, res) => {
        if (req.session.boRole !== 'admin') {
            res.status(403).send('Action réservée aux administrateurs.');
            return;
        }
        const config = new Config();
        const exportConfigFile = req.query.json === 'on';
        const exportDatabase = req.query.db === 'on';

        if (!exportConfigFile && !exportDatabase) {
            config.load();
            await sendMauiPage(req, res, config, {
                importExportError: 'Cochez au moins une case (JSON et/ou DB) avant d\'exporter.',
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
                importExportError: 'Rien à exporter : le(s) fichier(s) sélectionné(s) n\'existe(nt) pas encore.',
            });
            return;
        }

        if (files.length === 1) {
            res.download(files[0].path, files[0].name);
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
            res.status(403).send('Action réservée aux administrateurs.');
            return;
        }
        const config = new Config();
        config.load();

        if (!req.file) {
            await sendMauiPage(req, res, config, {importExportError: 'Aucun fichier fourni.'});
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
                        importExportError: 'Le ZIP ne contient ni mame-awesome-ui-config.json ni '
                            + 'mame-awesome-ui.sqlite.',
                    });
                    return;
                }
                if (configEntry) {
                    writeFileSync(config.configPath, configEntry.getData());
                    restored.push('la configuration');
                }
                if (dbEntry) {
                    writeFileSync(getDatabasePath(), dbEntry.getData());
                    restored.push('la base de données');
                }
            } else if (originalName.endsWith('.json')) {
                // Throws on malformed JSON, caught below - avoids overwriting the current
                // config with a file the app would then fail to load on next start.
                JSON.parse(req.file.buffer.toString('utf8'));
                writeFileSync(config.configPath, req.file.buffer);
                restored.push('la configuration');
            } else if (originalName.endsWith('.sqlite') || originalName.endsWith('.db')) {
                // Same sqlite file header every real .sqlite file starts with - cheap sanity
                // check against uploading an unrelated file under this extension.
                if (req.file.buffer.subarray(0, 16).toString('utf8') !== 'SQLite format 3\0') {
                    await sendMauiPage(req, res, config, {
                        importExportError: 'Ce fichier ne ressemble pas à une base de données '
                            + 'sqlite valide.',
                    });
                    return;
                }
                writeFileSync(getDatabasePath(), req.file.buffer);
                restored.push('la base de données');
            } else {
                await sendMauiPage(req, res, config, {
                    importExportError: 'Format non reconnu : utilisez un .json, un .sqlite/.db ou '
                        + 'un .zip contenant les deux.',
                });
                return;
            }
        } catch (error) {
            await sendMauiPage(req, res, config, {
                importExportError: `Import échoué : ${error instanceof Error ? error.message : String(error)}`,
            });
            return;
        }

        // Same reasoning as /reset's config/database branches: the renderer's long-lived Vuex
        // store instances (see store.ts's initServices) were built from the files just
        // overwritten, so only a full process restart picks up the import.
        res.send(renderPage(
            '<section class="card"><h2>Import effectué</h2>'
            + `<p class="error">Restauré : ${restored.join(', ')}. L'application va se fermer `
            + 'dans un instant. <strong>Relancez-la manuellement</strong> pour prendre en compte '
            + 'les fichiers importés (<code>just serve</code> en développement, ou l\'exécutable '
            + 'habituel en production).</p></section>',
            'maui',
        ));

        setTimeout(onReset, 300);
    });

    // Not role-gated beyond being logged in for a real release - installing one of those onto
    // the device the BO itself runs on is exactly what a "user"-role account (e.g. puckman) is
    // meant to be able to do, same trust level as everything else on the "Général" MAUI subtab.
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
            await sendMauiPage(req, res, config, {updateInfoError: 'Installation indisponible sur cette machine.'});
            return;
        }

        const preUpdateInfo = await getUpdateInfo();
        if (!isAdmin && preUpdateInfo.devBuilds.some(build => build.tagName === tagName)) {
            res.status(403).send('Action réservée aux administrateurs.');
            return;
        }

        res.writeHead(200, {'Content-Type': 'text/html; charset=utf-8'});
        res.socket?.setNoDelay(true);
        res.write(renderPageHead('maui'));
        await runUpdateInstall(res, `Installation de la version ${tagName}…`, assetUrl);

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
            values, hasScreenScraperCredentials(config), undefined, 'Configuration ScreenScraper enregistrée.',
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
                `Le dossier "${mamePath}" n'existe pas.`,
            ));
            return;
        }
        const mameBinaryName = findMameBinary(mamePath);
        if (!mameBinaryName) {
            res.status(422).send(renderForm(
                {mamePath}, getMameInfo(config), isAdmin,
                `Aucun binaire mame trouvé dans "${mamePath}".`,
            ));
            return;
        }

        try {
            ensureMameConfigBootstrapped(join(mamePath, mameBinaryName), getMameHomePath());
        } catch (error) {
            res.status(422).send(renderForm(
                {mamePath}, getMameInfo(config), isAdmin,
                'Échec de l\'initialisation de mame ("-createconfig") : '
                    + `${error instanceof Error ? error.message : 'erreur inattendue'}.`,
            ));
            return;
        }

        config.mamePath = mamePath;
        config.mameBinaryName = mameBinaryName;
        config.save();

        res.send(renderPage(
            '<section class="card"><h2>Configuration enregistrée</h2><p>'
            + 'L\'application redémarre automatiquement.</p>'
            + '<p>Retour à la configuration MAME dans <span id="redirect-countdown">5</span> '
            + 'seconde(s)… <a href="/">Y aller maintenant</a>.</p></section>'
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
            res.status(403).send('Action réservée aux administrateurs.');
            return;
        }

        if (!config.mamePath || !config.mameBinaryName) {
            res.status(422).send(renderForm(
                {mamePath: config.mamePath || ''},
                getMameInfo(config), isAdmin,
                'Aucune configuration valide enregistrée : impossible de lancer mame.',
            ));
            return;
        }

        const mameBinary = join(config.mamePath, config.mameBinaryName);
        if (!existsSync(mameBinary)) {
            res.status(422).send(renderForm(
                {mamePath: config.mamePath},
                getMameInfo(config), isAdmin,
                `Le binaire "${mameBinary}" est introuvable.`,
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
            'Mame a été lancé, vérifiez qu\'une fenêtre s\'est bien ouverte sur la machine qui héberge mame-awesome-ui.',
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
            // separate "Réparer plugin.ini" button as a second step.
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
                ? 'Options MAME mises à jour dans mame.ini.'
                    + (pluginsAdded ? ` ${pluginsAdded} plugin(s) initialisé(s) dans plugin.ini.` : '')
                : 'mame.ini introuvable - configurez et lancez mame au moins une fois avant de changer ces options.',
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
                ? `${added} plugin(s) ajouté(s) à plugin.ini (valeurs par défaut de mame).`
                : 'Rien à réparer : plugin.ini contient déjà tous les plugins détectés (ou aucun plugin trouvé - vérifiez le dossier des plugins ci-dessous).',
        ));
    });

    app.post('/input-probe', (req, res) => {
        if (req.session.boRole !== 'admin') {
            res.status(403).send('Action réservée aux administrateurs.');
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
                {selectedRom: romName, error: 'Rom invalide ou introuvable dans le dossier des roms.'},
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
            const message = error instanceof Error ? error.message : 'erreur inattendue';
            res.status(500).send(renderForm(
                {mamePath: config.mamePath}, mameInfo, isAdmin,
                undefined, undefined, undefined, undefined, undefined,
                {
                    selectedRom: romName,
                    error: `Échec du sondage de "${romName}" : ${message}`
                        + ' (timeout, code de sortie non nul, ou binaire introuvable).',
                },
            ));
        }
    });

    app.post('/input-probe/devices', (req, res) => {
        if (req.session.boRole !== 'admin') {
            res.status(403).send('Action réservée aux administrateurs.');
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
            const message = error instanceof Error ? error.message : 'erreur inattendue';
            res.status(500).send(renderForm(
                {mamePath: config.mamePath}, mameInfo, isAdmin,
                undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined,
                {error: `Échec du sondage des périphériques : ${message} (timeout, code de sortie non nul, ou binaire introuvable).`},
            ));
        }
    });

    app.post('/input-probe/mame/start', (req, res) => {
        if (req.session.boRole !== 'admin') {
            res.status(403).send('Action réservée aux administrateurs.');
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
            res.status(403).send('Action réservée aux administrateurs.');
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
            res.status(403).send('Action réservée aux administrateurs.');
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
                {portType, error: 'MAME n\'est pas lancé - clique sur "Lancer MAME" d\'abord.'},
            ));
            return;
        }

        try {
            const token = captureOnePress();
            const remapState: RemapState = token
                ? {portType, capturedToken: token}
                : {portType, error: 'Aucun appui détecté dans le délai imparti (30s) - réessaie ' +
                    '(la fenêtre MAME doit avoir le focus).'};
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
            const message = error instanceof Error ? error.message : 'erreur inattendue';
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
                {portType, error: `Échec de la capture : ${message}`},
            ));
        }
    });

    app.post('/reset', async (req, res) => {
        if (req.session.boRole !== 'admin') {
            res.status(403).send('Action réservée aux administrateurs.');
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
                    `tout le répertoire ${mameInfo.iniPath} et son contenu (configuration, roms, médias, `
                    + 'hiscores, cfg, nvram, snapshots...)',
                );
            } catch (error) {
                console.error(`[boServer] Failed to remove mame home directory "${mameInfo.iniPath}":`, error);
            }
        }

        if (deleteHiscores) {
            try {
                rmSync(getHiscorePath(mameInfo.iniPath), {recursive: true, force: true});
                deleted.push('les hiscores');
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
            deleted.push('les roms et médias des jeux (roms, marquees, flyers, logos)');
        }

        if (deleteFavorites) {
            try {
                // Cast: gated above on !!mameInfo.favoritesPath.
                rmSync(mameInfo.favoritesPath as string, {force: true});
                deleted.push('le fichier des favoris (favorites.ini)');
            } catch (error) {
                console.error('[boServer] Failed to remove favorites.ini:', error);
            }
        }

        if (deleteConfig) {
            config.delete();
            deleted.push('la configuration de mame-awesome-ui');
        }

        if (deleteDatabase) {
            try {
                rmSync(getDatabasePath(), {force: true});
                deleted.push('la base de données');
            } catch (error) {
                console.error('[boServer] Failed to remove database file:', error);
            }
        }

        if (!deleted.length) {
            if (zone === 'mame') {
                res.send(renderForm(
                    {mamePath: config.mamePath || ''}, mameInfo, true,
                    undefined, undefined, undefined, undefined,
                    'Aucune case cochée : rien à supprimer.',
                ));
            } else {
                await sendMauiPage(req, res, config, {dangerZoneInfo: 'Aucune case cochée : rien à supprimer.'});
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
        const deletedInfo = `Supprimé : ${deleted.join(', ')}.`;

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
            '<section class="card"><h2>Suppression effectuée</h2>'
            + `<p class="error">${deletedInfo}</p>`
            + '<p>L\'application va se fermer dans un instant. '
                + '<strong>Relancez-la manuellement</strong> pour terminer l\'opération '
                + '(<code>just serve</code> en développement, ou l\'exécutable habituel en '
                + 'production) - recharger cette page ou l\'application ne suffit pas : le '
                + 'renderer garde en mémoire les services construits sur l\'ancienne '
                + 'configuration tant que le process n\'a pas complètement redémarré.</p>'
                + '<p id="restart-wait-message" class="info">En attente du redémarrage… '
                + 'cette page vous ramènera automatiquement à l\'accueil dès que le serveur '
                + 'sera de nouveau disponible.</p>'
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
