import express from 'express';
import {Server} from 'http';
import {existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync} from 'fs';
import {join, dirname, sep, basename} from 'path';
import * as os from 'os';
import {execFile, execFileSync} from 'child_process';
import multer from 'multer';
// Pinned (see package.json) to the last 0.5.x release: 0.5.17+/0.6.x ship optional-chaining
// syntax in methods/inflater.js that the main process's webpack build (older acorn parser)
// fails to parse. Bumping this past 0.5.16 breaks `just serve`/`just build` with a
// "Module parse failed: Unexpected token" error on that file - re-check before upgrading.
import AdmZip from 'adm-zip';
import Config from '@/class/Config.class';
import ScreenScraperClient, {ScreenScraperCredentials} from '@/class/ScreenScraperClient.class';
import {StartingPackManifest} from '@/types/StartingPackManifest';
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
import {UniqueConstraintError, ValidationError} from 'sequelize';

declare const __static: string;

type Tab = 'mame' | 'screenscraper' | 'favorites' | 'users' | 'import' | 'maui';
type PathField = 'mamePath' | 'pluginsPath';

interface ScreenScraperValues {
    ssDevId: string;
    ssDevPassword: string;
    ssSoftName: string;
    ssUserId: string;
    ssUserPassword: string;
}

const MAME_BINARY_NAMES = ['mame.exe', 'mame64.exe', 'mame'];

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
    execFileSync(mameBinary, ['-createconfig'], {cwd: iniPath});
    if (!existsSync(uiIniPath)) {
        throw new Error(`"${uiIniPath}" introuvable après -createconfig.`);
    }
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
 * Filenames currently sitting in Config's fixed avatarsPath (<home>/.mame-awesome-ui/avatars,
 * created eagerly by Config's constructor). Matches the "<pseudo_3>.png" lookup
 * UserService.class.ts/Champions.vue/Hiscores.vue use in the Electron app itself.
 */
function getAvatarFilenames(config: Config): string[] {
    return readdirSync(config.avatarsPath);
}

/**
 * True only for a request from the machine the BO server itself runs on. app.listen() below
 * binds every interface, not just loopback, so the BO is reachable from the rest of the LAN -
 * fine for browsing config/favorites/users remotely, but launching mame only makes sense on
 * the cabinet's own display. Checked against the raw socket address (not req.ip, which would
 * follow X-Forwarded-For if this ever sat behind a proxy - it doesn't, and shouldn't be
 * spoofable into bypassing this check if it ever did).
 */
function isLocalhostRequest(req: {socket: {remoteAddress?: string}}): boolean {
    const address = req.socket.remoteAddress;
    return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';
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
        models: [Category, Game, User, Hiscore],
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
    if (path[0] === '/') {
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
 * favorites.ini the first time a favorite is added, and genre.ini/Multiplayer.ini are only
 * ever written by a starting pack import - see importStartingPack() - which every pack bundles
 * a copy of both).
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
 * Same resolution as getMameLocations().favoritesPath, but - unlike that one, which stays null
 * on purpose when favorites.ini doesn't exist yet (mame itself is meant to be the only writer)
 * - creates the target ui_path directory when needed and returns where favorites.ini should be
 * written. Needed for importing a starting pack onto a brand new install that has no
 * favorites.ini at all yet.
 */
function ensureFavoritesPath(iniPath: string): string {
    const uiIniPath = join(iniPath, 'ui.ini');
    const uiIni = existsSync(uiIniPath) ? parseMameIniFile(readFileSync(uiIniPath, 'utf8')) : {};
    const existing = uiIni.ui_path ? getFirstExistingDirectory(uiIni.ui_path, iniPath, 'favorites.ini') : null;
    if (existing) {
        return existing;
    }
    const dir = ensureFirstDirectory(uiIni.ui_path, iniPath);
    if (!dir) {
        throw new Error('ui_path introuvable dans ui.ini.');
    }
    return join(dir, 'favorites.ini');
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
            iniPath, mameIniPath, uiIniPath, romPath: null, marqueePath, flyerPath, logoPath, favoritesPath,
            genreIniPath, nplayersIniPath, windowed, pluginsPath, missingPlugins,
            error: 'Configurez le binaire mame ci-dessus pour voir le chemin des roms.',
        };
    }

    const mameBinary = join(config.mamePath, config.mameBinaryName);
    if (!existsSync(mameBinary)) {
        return {
            iniPath, mameIniPath, uiIniPath, romPath: null, marqueePath, flyerPath, logoPath, favoritesPath,
            genreIniPath, nplayersIniPath, windowed, pluginsPath, missingPlugins,
            error: `Le binaire "${mameBinary}" est introuvable.`,
        };
    }

    try {
        const output = execFileSync(
            mameBinary,
            ['-showconfig', '-inipath', iniPath, '-homepath', iniPath],
            {cwd: iniPath},
        );
        const parsed = parseMameIniFile(output.toString());
        const romPath = ensureFirstDirectory(parsed.rompath, iniPath);
        return {
            iniPath, mameIniPath, uiIniPath, romPath, marqueePath, flyerPath, logoPath, favoritesPath,
            genreIniPath, nplayersIniPath, windowed, pluginsPath, missingPlugins,
        };
    } catch {
        return {
            iniPath, mameIniPath, uiIniPath, romPath: null, marqueePath, flyerPath, logoPath, favoritesPath,
            genreIniPath, nplayersIniPath, windowed, pluginsPath, missingPlugins,
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

interface GameXmlInfo {
    description: string | null;
    // The name of the separate BIOS set this game needs (mame -lx's `romof` attribute on
    // <machine>), e.g. "neogeo" - null when the game is self-contained.
    biosName: string | null;
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
            {encoding: 'utf8', cwd: iniPath},
        );
        return {
            description: extractXmlTagContent(xmlContent, 'description'),
            biosName: extractXmlAttribute(xmlContent, 'machine', 'romof'),
        };
    } catch {
        return {description: null, biosName: null};
    }
}

interface FavoriteRow {
    romName: string;
    fullname: string;
    biosName: string | null;
    hasMarquee: boolean;
    hasFlyer: boolean;
    hasLogo: boolean;
}

interface FavoritesInfo {
    rows: FavoriteRow[];
    error?: string;
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
 * Resolves a single favorite's row - the slow part (a blocking `mame -lx` process spawn per
 * call, see getGameXmlInfo()) callers should interleave with res.write() progress so a long
 * favorites list streams in instead of blocking the whole response.
 */
function resolveFavoriteRow(context: FavoritesContext, romName: string): FavoriteRow {
    const {mameBinary, iniPath, marqueePath, flyerPath, logoPath} = context;
    const {description, biosName} = getGameXmlInfo(mameBinary, iniPath, romName);
    return {
        romName,
        fullname: description || romName,
        biosName,
        hasMarquee: !!marqueePath && existsSync(join(marqueePath, romName + '.png')),
        hasFlyer: !!flyerPath && existsSync(join(flyerPath, romName + '.png')),
        hasLogo: !!logoPath && existsSync(join(logoPath, romName + '.png')),
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
    rows: FavoriteRow[],
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

interface ImportSummary {
    gamesUpserted: number;
    romFilesWritten: number;
    biosFilesWritten: number;
    marqueesWritten: number;
    flyersWritten: number;
    logosWritten: number;
    favoritesReplaced: boolean;
    genreIniReplaced: boolean;
    nplayersIniReplaced: boolean;
    categoriesCreated: string[];
    warnings: string[];
    errors: string[];
}

/**
 * Ingests a starting pack ZIP (built by scripts/build-starting-pack.ts): for every rom present
 * in the pack, overwrites its Game row, rom file, marquee, flyer and logo (full-replacement, by
 * design - nothing outside the pack's scope is touched), then replaces favorites.ini wholesale
 * with the pack's copy. One rom failing (missing entry, DB error) is logged as a warning/error
 * and skipped rather than aborting the whole import, mirroring the pack builder's own
 * warn-and-continue policy.
 */
async function importStartingPack(
    zip: AdmZip,
    manifest: StartingPackManifest,
    romPath: string,
    marqueePath: string,
    flyerPath: string,
    logoPath: string,
    categoryDir: string,
    iniPath: string,
    onProgress: (line: string) => void,
): Promise<ImportSummary> {
    const summary: ImportSummary = {
        gamesUpserted: 0, romFilesWritten: 0, biosFilesWritten: 0, marqueesWritten: 0,
        flyersWritten: 0, logosWritten: 0, favoritesReplaced: false, genreIniReplaced: false,
        nplayersIniReplaced: false, categoriesCreated: [], warnings: [], errors: [],
    };
    const categoryIds = new Map<string, number>();

    // genre.ini/Multiplayer.ini first, before touching the database at all: on a genuinely
    // fresh install (no sqlite file yet, e.g. importing a pack before ever launching the
    // Electron app), sequelize.sync() below is what creates the category/game tables in the
    // first place - and Database.install() (the app's own first-run path, see Database.class.ts)
    // now refuses to run without these two files present, so the pack importing them is the
    // only way they ever get there on such an install.
    const genreEntry = zip.getEntry('genre.ini');
    if (genreEntry) {
        writeFileSync(join(categoryDir, 'genre.ini'), zip.readAsText(genreEntry), 'utf8');
        summary.genreIniReplaced = true;
    } else {
        summary.warnings.push('genre.ini absent du ZIP (pack invalide ou obsolète) - catégories inchangées.');
    }

    const nplayersEntry = zip.getEntry('Multiplayer.ini');
    if (nplayersEntry) {
        writeFileSync(join(categoryDir, 'Multiplayer.ini'), zip.readAsText(nplayersEntry), 'utf8');
        summary.nplayersIniReplaced = true;
    } else {
        summary.warnings.push(
            'Multiplayer.ini absent du ZIP (pack invalide ou obsolète) - nombre de joueurs inchangé.',
        );
    }

    // Creates the category/game/user/hiscore tables if this is a fresh sqlite file with none
    // yet (no-op otherwise - sync() without force/alter never touches existing tables/data).
    // Category.sequelize is the single connection createSequelize() registered at BO startup.
    await Category.sequelize!.sync();

    for (const biosName of manifest.biosRoms) {
        const entry = zip.getEntry(`roms/${biosName}.zip`);
        if (!entry) {
            summary.warnings.push(`BIOS "${biosName}" : absent du ZIP, ignoré.`);
            continue;
        }
        if (zip.extractEntryTo(entry, romPath, false, true)) {
            summary.biosFilesWritten++;
        } else {
            summary.warnings.push(`BIOS "${biosName}" : échec de l'extraction.`);
        }
    }

    for (const game of manifest.games) {
        try {
            let categoryId: number | null = null;
            if (game.categoryName) {
                categoryId = categoryIds.get(game.categoryName) ?? null;
                if (categoryId === null) {
                    const [category, created] = await Category.findOrCreate({
                        where: {name: game.categoryName},
                        defaults: {name: game.categoryName} as Category,
                    });
                    categoryId = category.id_category;
                    categoryIds.set(game.categoryName, categoryId);
                    if (created) {
                        summary.categoriesCreated.push(game.categoryName);
                    }
                }
            }

            const romEntry = game.hasRomFile ? zip.getEntry(`roms/${game.romName}.zip`) : null;
            if (romEntry) {
                if (zip.extractEntryTo(romEntry, romPath, false, true)) {
                    summary.romFilesWritten++;
                } else {
                    summary.warnings.push(`${game.romName} : échec de l'extraction de la rom.`);
                }
            } else if (game.hasRomFile) {
                summary.warnings.push(`${game.romName} : rom annoncée dans le manifest mais absente du ZIP.`);
            }

            const marqueeEntry = game.hasMarquee ? zip.getEntry(`marquees/${game.romName}.png`) : null;
            if (marqueeEntry && zip.extractEntryTo(marqueeEntry, marqueePath, false, true)) {
                summary.marqueesWritten++;
            }
            const flyerEntry = game.hasFlyer ? zip.getEntry(`flyers/${game.romName}.png`) : null;
            if (flyerEntry && zip.extractEntryTo(flyerEntry, flyerPath, false, true)) {
                summary.flyersWritten++;
            }
            const logoEntry = game.hasLogo ? zip.getEntry(`logos/${game.romName}.png`) : null;
            if (logoEntry && zip.extractEntryTo(logoEntry, logoPath, false, true)) {
                summary.logosWritten++;
            }

            const gameFields = {
                id_category: categoryId,
                fullname: game.fullname,
                shortname: game.shortname,
                subname: game.subname,
                manufacturer: game.manufacturer,
                year: game.year ? parseInt(game.year, 10) : null,
                hi: false,
                player_alt: game.player_alt,
                player_sim: game.player_sim,
            };
            // paranoid: true (see Game.model.ts) means a game GameService.saveGamesFromRomNames
            // previously dropped (e.g. favorites.ini emptied by a reset) is only soft-deleted -
            // its romName still occupies the unique constraint. A plain findOne() (which hides
            // soft-deleted rows) would miss it and Game.create() would then collide with that
            // constraint, so look it up with paranoid:false and restore() it if needed.
            const existing = await Game.findOne({where: {romName: game.romName}, paranoid: false});
            if (existing) {
                await existing.restore();
                await existing.update(gameFields);
            } else {
                await Game.create({romName: game.romName, ...gameFields} as Game);
            }
            summary.gamesUpserted++;
            onProgress(`${game.romName} : ${game.fullname} importé.`);
        } catch (error) {
            const message = error instanceof ValidationError
                ? error.errors.map(e => e.message).join(', ')
                : (error instanceof Error ? error.message : 'erreur inattendue');
            summary.errors.push(`${game.romName} : ${message}`);
            onProgress(`${game.romName} : erreur (${message}).`);
        }
    }

    const favoritesEntry = zip.getEntry('favorites.ini');
    if (favoritesEntry) {
        writeFileSync(ensureFavoritesPath(iniPath), zip.readAsText(favoritesEntry), 'utf8');
        summary.favoritesReplaced = true;
    } else {
        summary.warnings.push('favorites.ini absent du ZIP, favoris inchangés.');
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

function renderPage(body: string, active: Tab = 'mame'): string {
    return renderPageHead(active) + body + renderPageTail();
}

/**
 * Head/style/header/nav prelude, split out from renderPage() so a route can stream a page in
 * chunks with res.write() (progress feedback for a long-running action) instead of building
 * the whole HTML string before sending anything.
 */
function renderPageHead(active: Tab = 'mame'): string {
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
        input {
            width: 100%;
            box-sizing: border-box;
            padding: 8px;
            margin-top: 4px;
        }
        button {
            padding: 8px 16px;
            color: #000000;
        }
        form > button[type="submit"]:last-child {
            margin-top: 24px;
        }
        .error {
            color: #ff6b6b;
        }
        .info {
            color: #8ab4f8;
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
        .launch-button:disabled {
            opacity: 0.5;
            cursor: not-allowed;
        }
        .launch-logo {
            height: 20px;
            width: auto;
        }
        .checkbox-row {
            display: flex;
            align-items: center;
            gap: 8px;
            margin-top: 16px;
        }
        .checkbox-row input {
            width: auto;
            margin-top: 0;
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
    </style>
</head>
<body>
    <header>
        <h1>mame-awesome-ui</h1>
        <nav class="tabs">
            <a href="/" class="${active === 'mame' ? 'active' : ''}">MAME</a>
            <a href="/favorites" class="${active === 'favorites' ? 'active' : ''}">Favoris</a>
            <a href="/users" class="${active === 'users' ? 'active' : ''}">Users</a>
            <a href="/screenscraper" class="${active === 'screenscraper' ? 'active' : ''}">ScreenScraper</a>
            <a href="/import" class="${active === 'import' ? 'active' : ''}">Import</a>
            <a href="/maui" class="${active === 'maui' ? 'active' : ''}">MAUI</a>
        </nav>
    </header>
    `;
}

function renderPageTail(): string {
    return `
</body>
</html>`;
}

interface ConfigFormValues {
    mamePath: string;
    // Whether the current request came from the machine running the BO itself. The BO listens
    // on every network interface (app.listen() below has no host argument), so it's reachable
    // from the rest of the LAN - but launching mame only makes sense on the cabinet's own
    // display, not from whoever else can open this page over the network. Threaded through
    // instead of re-derived in renderConfigCard() since only the request, not the rendered
    // HTML, knows where it came from.
    isLocal: boolean;
}

function renderConfigCard(values: ConfigFormValues, error?: string, info?: string): string {
    return `
        <section class="card">
            <h2>Configuration</h2>
            ${error ? `<p class="error">${escapeHtml(error)}</p>` : ''}
            ${info ? `<p class="info">${escapeHtml(info)}</p>` : ''}
            <form method="post" action="/save" novalidate>
                <label for="mamePath">Dossier contenant le binaire mame</label>
                <div class="path-row">
                    <input type="text" id="mamePath" name="mamePath" value="${escapeHtml(values.mamePath)}">
                    <button type="submit" name="target" value="mamePath" formaction="/browse" formmethod="get">Parcourir</button>
                </div>
                <div class="button-row">
                    <button type="submit">Enregistrer</button>
                    ${values.isLocal
                        ? `<button type="submit" formaction="/launch" formmethod="post" class="launch-button">
                            <img src="/mame-logo.svg" alt="" class="launch-logo">
                            Lancer mame
                        </button>`
                        : `<button type="button" class="launch-button" disabled
                            title="Disponible uniquement depuis la machine qui héberge mame-awesome-ui.">
                            <img src="/mame-logo.svg" alt="" class="launch-logo">
                            Lancer mame
                        </button>`}
                </div>
                ${values.isLocal ? '' : `<p class="info">Le lancement de mame n'est possible que depuis la
                    machine qui héberge mame-awesome-ui, pas depuis le réseau local.</p>`}
            </form>
        </section>
    `;
}

function renderMameInfoCard(mameInfo: MameInfo, info?: string): string {
    return `
        <section class="card">
            <h2>Informations MAME</h2>
            ${mameInfo.error ? `<p class="error">${escapeHtml(mameInfo.error)}</p>` : ''}
            ${info ? `<p class="info">${escapeHtml(info)}</p>` : ''}
            <dl>
                <div class="info-field">
                    <dt>Dossier home mame (ini, cfg, nvram, snapshots...)</dt>
                    <dd>${escapeHtml(mameInfo.iniPath)}</dd>
                </div>
                <div class="info-field">
                    <dt>Fichier mame.ini</dt>
                    <dd>${escapeHtml(mameInfo.mameIniPath)}</dd>
                </div>
                <div class="info-field">
                    <dt>Fichier ui.ini</dt>
                    <dd>${escapeHtml(mameInfo.uiIniPath)}</dd>
                </div>
                <div class="info-field">
                    <dt>Dossier des roms (rompath)</dt>
                    <dd>${mameInfo.romPath ? escapeHtml(mameInfo.romPath) : '<em>Non disponible</em>'}</dd>
                </div>
                <div class="info-field">
                    <dt>Dossier des marquees (marquees_directory)</dt>
                    <dd>${mameInfo.marqueePath ? escapeHtml(mameInfo.marqueePath) : '<em>Non disponible</em>'}</dd>
                </div>
                <div class="info-field">
                    <dt>Dossier des flyers (flyers_directory)</dt>
                    <dd>${mameInfo.flyerPath ? escapeHtml(mameInfo.flyerPath) : '<em>Non disponible</em>'}</dd>
                </div>
                <div class="info-field">
                    <dt>Dossier des logos (logos_directory)</dt>
                    <dd>${mameInfo.logoPath ? escapeHtml(mameInfo.logoPath) : '<em>Non disponible</em>'}</dd>
                </div>
                <div class="info-field">
                    <dt>Fichier des favoris (favorites.ini)</dt>
                    <dd>${mameInfo.favoritesPath
                        ? escapeHtml(mameInfo.favoritesPath)
                        : '<em>Aucun favori pour l\'instant — ajoutez-en depuis le menu de MAME (Tab en jeu).</em>'}</dd>
                </div>
                <div class="info-field">
                    <dt>Fichier des genres (genre.ini, categorypath)</dt>
                    <dd>${mameInfo.genreIniPath
                        ? escapeHtml(mameInfo.genreIniPath)
                        : '<em>Introuvable — importez un starting pack (onglet Import) pour '
                            + 'l\'installer au chemin indiqué par categorypath dans ui.ini.</em>'}</dd>
                </div>
                <div class="info-field">
                    <dt>Fichier du nombre de joueurs (Multiplayer.ini, categorypath)</dt>
                    <dd>${mameInfo.nplayersIniPath
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
                    <p class="error">plugin.ini est incomplet : ${mameInfo.missingPlugins.length} plugin(s)
                    détecté(s) dans le dossier des plugins mais absent(s) de plugin.ini
                    (${escapeHtml(mameInfo.missingPlugins.join(', '))}).</p>
                    <button type="submit">Réparer plugin.ini (ajouter les plugins manquants)</button>
                </form>
            ` : ''}
        </section>
    `;
}

function renderDangerZoneCard(mameInfo: MameInfo): string {
    // No apostrophes in these messages: embedded in single-quoted JS string literals inside the
    // onsubmit attribute below (same pattern as the user-delete confirm()).
    const confirmMessage = 'Supprimer definitivement la configuration de mame-awesome-ui et tout '
        + 'le dossier home de mame (roms, marquees, flyers, favoris, sauvegardes, scores) ? '
        + 'Cette action est irreversible.';
    const confirmMessageWithDb = 'Supprimer definitivement la configuration de mame-awesome-ui, '
        + 'tout le dossier home de mame (roms, marquees, flyers, favoris, sauvegardes, scores) '
        + 'ET la base de donnees (jeux, utilisateurs, scores) ? Cette action est irreversible.';
    return `
        <section class="card">
            <h2>Zone dangereuse</h2>
            <p class="error">Réinitialise complètement mame-awesome-ui pour repartir de zéro :
            supprime le fichier de configuration (mame-awesome-ui-config.json) et tout le dossier
            home de mame - <strong>${escapeHtml(mameInfo.iniPath)}</strong> - donc ses roms,
            marquees, flyers, favoris, sauvegardes et scores. La base de données (jeux,
            utilisateurs, scores) n'est pas touchée, sauf si vous cochez la case ci-dessous.
            Cette action est irréversible. L'application se ferme ensuite - il faudra la relancer
            manuellement (<code>just serve</code> en développement) pour terminer la
            réinitialisation.</p>
            <form method="post" action="/reset"
                onsubmit="return confirm(this.deleteDatabase.checked ? '${confirmMessageWithDb}' : '${confirmMessage}')">
                <label class="checkbox-row">
                    <input type="checkbox" name="deleteDatabase">
                    Supprimer aussi la base de données (jeux, utilisateurs, scores)
                </label>
                <button type="submit">Réinitialiser l'application</button>
            </form>
        </section>
    `;
}

function renderForm(
    values: ConfigFormValues,
    mameInfo: MameInfo,
    error?: string,
    info?: string,
    mameInfoMessage?: string,
): string {
    return renderPage(
        renderConfigCard(values, error, info)
        + renderMameInfoCard(mameInfo, mameInfoMessage),
        'mame',
    );
}

function renderMauiCard(config: Config, info?: string): string {
    return `
        <section class="card">
            <h2>mame-awesome-ui</h2>
            ${info ? `<p class="info">${escapeHtml(info)}</p>` : ''}
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

function renderMauiPage(config: Config, mameInfo: MameInfo, info?: string): string {
    return renderPage(renderMauiCard(config, info) + renderDangerZoneCard(mameInfo), 'maui');
}

function renderScreenScraperCard(values: ScreenScraperValues, error?: string, info?: string): string {
    return `
        <section class="card">
            <h2>ScreenScraper</h2>
            <p>Identifiants utilisés pour récupérer marquees, flyers et autres visuels depuis
            <a href="https://www.screenscraper.fr" target="_blank" rel="noopener">screenscraper.fr</a>.</p>
            ${error ? `<p class="error">${escapeHtml(error)}</p>` : ''}
            ${info ? `<p class="info">${escapeHtml(info)}</p>` : ''}
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
                <button type="submit">Enregistrer</button>
            </form>
        </section>
    `;
}

function renderScreenScraperPage(values: ScreenScraperValues, error?: string, info?: string): string {
    return renderPage(renderScreenScraperCard(values, error, info), 'screenscraper');
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
        <p class="info">${escapeHtml(parts.join(' — '))}${summary.stoppedForQuota
            ? ' — arrêté : quota ScreenScraper dépassé, réessayez plus tard.'
            : ''}</p>
        ${errorsHtml}
    `;
}

function renderFavoritesCard(favoritesInfo: FavoritesInfo, hasCreds: boolean, summary?: DownloadSummary): string {
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
            <td>${renderGameName(row.fullname)}</td>
            <td>${row.biosName ? escapeHtml(row.biosName) : '<em>-</em>'}</td>
            <td class="center">${renderFavoriteBadge(row.hasMarquee)}</td>
            <td class="center">${renderFavoriteBadge(row.hasFlyer)}</td>
            <td class="center">${renderFavoriteBadge(row.hasLogo)}</td>
        </tr>
    `).join('');

    const downloadSection = hasCreds
        ? `
            ${summary ? renderDownloadSummary(summary) : ''}
            <form method="post" action="/favorites/download-media">
                <p class="info">Télécharge les marquees/flyers/logos manquants depuis ScreenScraper pour les
                favoris ci-dessous. Traitement synchrone, peut prendre plusieurs minutes selon le nombre de
                favoris (délai imposé entre chaque appel) - ne fermez pas cette page pendant le
                téléchargement.</p>
                <button type="submit">Télécharger les visuels manquants</button>
            </form>
        `
        : '<p class="error">Identifiants ScreenScraper manquants : configurez-les dans l\'onglet ScreenScraper.</p>';

    return `
        <section class="card">
            <h2>Favoris (${favoritesInfo.rows.length})</h2>
            <div class="table-wrap">
                <table class="favorites-table">
                    <thead>
                        <tr>
                            <th>Shortname</th>
                            <th>Name</th>
                            <th>Bios</th>
                            <th class="center">Marquee</th>
                            <th class="center">Flyer</th>
                            <th class="center">Logo</th>
                        </tr>
                    </thead>
                    <tbody>${rows}</tbody>
                </table>
            </div>
            ${downloadSection}
        </section>
    `;
}

function renderFavoritesPage(favoritesInfo: FavoritesInfo, hasCreds: boolean, summary?: DownloadSummary): string {
    return renderPage(renderFavoritesCard(favoritesInfo, hasCreds, summary), 'favorites');
}

function renderImportCard(error?: string): string {
    return `
        <section class="card">
            <h2>Importer un starting pack</h2>
            <p class="info">Remplace intégralement les jeux/roms/artwork/favoris présents dans
            le pack. Les autres jeux, utilisateurs et scores ne sont pas touchés.</p>
            ${error ? `<p class="error">${escapeHtml(error)}</p>` : ''}
            <form method="post" action="/import" enctype="multipart/form-data">
                <label for="pack">Fichier ZIP</label>
                <input type="file" id="pack" name="pack" accept=".zip" required>
                <button type="submit">Importer</button>
            </form>
        </section>
    `;
}

function renderImportSummary(summary: ImportSummary): string {
    const parts = [
        `${summary.gamesUpserted} jeu(x) importé(s)`,
        `${summary.romFilesWritten} rom(s) écrite(s)`,
        `${summary.biosFilesWritten} bios écrite(s)`,
        `${summary.marqueesWritten} marquee(s)`,
        `${summary.flyersWritten} flyer(s)`,
        `${summary.logosWritten} logo(s)`,
        summary.favoritesReplaced ? 'favoris remplacés' : 'favoris inchangés',
        summary.genreIniReplaced ? 'genre.ini remplacé' : 'genre.ini inchangé',
        summary.nplayersIniReplaced ? 'Multiplayer.ini remplacé' : 'Multiplayer.ini inchangé',
        `${summary.errors.length} erreur(s)`,
    ];
    const categoriesHtml = summary.categoriesCreated.length
        ? `<p class="info">Catégorie(s) créée(s) : ${escapeHtml(summary.categoriesCreated.join(', '))}</p>`
        : '';
    const issues = [...summary.warnings, ...summary.errors];
    const issuesHtml = issues.length
        ? `<ul>${issues.map(issue => `<li>${escapeHtml(issue)}</li>`).join('')}</ul>`
        : '';
    return `
        <p class="info">${escapeHtml(parts.join(' — '))}</p>
        ${categoriesHtml}
        ${issuesHtml}
    `;
}

function renderImportPage(error?: string): string {
    return renderPage(renderImportCard(error), 'import');
}

function renderUserStatusBadge(active: boolean): string {
    return active ? '<span class="badge-yes">✓ actif</span>' : '<span class="badge-no">✗ inactif</span>';
}

function renderCreateUserCard(): string {
    return `
        <section class="card">
            <h2>Ajouter un utilisateur</h2>
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
            <h2>Utilisateurs (${users.length})</h2>
            ${error ? `<p class="error">${escapeHtml(error)}</p>` : ''}
            ${info ? `<p class="info">${escapeHtml(info)}</p>` : ''}
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
                    <tbody>${rows || '<tr><td colspan="6"><em>Aucun utilisateur</em></td></tr>'}</tbody>
                </table>
            </div>
        </section>
    `;
}

function renderUsersPage(users: User[], avatarFilenames: string[], error?: string, info?: string): string {
    return renderPage(renderCreateUserCard() + renderUsersListCard(users, avatarFilenames, error, info), 'users');
}

/**
 * Friendly message for the common User.create() failure modes (unique pseudo_3,
 * length validators) instead of a raw Sequelize error dump.
 */
function describeUserError(error: unknown): string {
    if (error instanceof UniqueConstraintError) {
        return 'Un utilisateur avec ce pseudo existe déjà.';
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
            ${error ? `<p class="error">${escapeHtml(error)}</p>` : ''}
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
    // Memory storage (not disk): the import route reads the upload straight into AdmZip, no
    // temp file to clean up afterwards.
    const upload = multer({storage: multer.memoryStorage(), limits: {fileSize: 500 * 1024 * 1024}});
    const avatarUpload = multer({storage: multer.memoryStorage(), limits: {fileSize: 5 * 1024 * 1024}});
    // Single connection for the server's lifetime: sequelize-typescript's static model methods
    // (User.findAll(), etc.) bind to whichever Sequelize instance last registered the model, so
    // this must not be recreated per-request.
    createSequelize();

    app.get('/background.jpg', (req, res) => {
        res.sendFile(join(__static, 'img/background.jpg'));
    });

    app.get('/mame-logo.svg', (req, res) => {
        res.sendFile(join(__static, 'img/mame-logo.svg'));
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
            {mamePath, isLocal: isLocalhostRequest(req)}, mameInfo,
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
        }));
    });

    app.get('/favorites', (req, res) => {
        const config = new Config();
        config.load();
        const context = getFavoritesContext(config);

        if ('error' in context) {
            res.send(renderFavoritesPage({rows: [], error: context.error}, hasScreenScraperCredentials(config)));
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
                <h2>Chargement des favoris (${context.romNames.length})…</h2>
                <ul class="progress-log">
        `);

        const rows: FavoriteRow[] = context.romNames.map((romName) => {
            const row = resolveFavoriteRow(context, romName);
            res.write(`<li>${escapeHtml(row.romName)} : ${escapeHtml(row.fullname)}</li>`);
            return row;
        });

        res.write('</ul></section>');
        res.write(renderFavoritesCard({rows}, hasScreenScraperCredentials(config)));
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
                + 'lancez l\'application une première fois avant de gérer les utilisateurs.'));
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
            res.send(renderUsersPage(users, avatarFilenames, undefined, `Utilisateur "${pseudo3}" créé.`));
        } catch (error) {
            const users = await User.findAll({order: [['pseudo_3', 'ASC']]}).catch(() => []);
            res.status(422).send(renderUsersPage(users, avatarFilenames, describeUserError(error)));
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
            user ? `Utilisateur "${user.pseudo_3}" mis à jour.` : undefined,
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
            user ? `Utilisateur "${user.pseudo_3}" supprimé.` : undefined,
        ));
    });

    app.post('/users/:id/avatar', avatarUpload.single('avatar'), async (req, res) => {
        const user = await User.findByPk(req.params.id);
        const users = await User.findAll({order: [['pseudo_3', 'ASC']]}).catch(() => []);
        const config = new Config();

        if (!user) {
            res.status(404).send(renderUsersPage(users, getAvatarFilenames(config), 'Utilisateur introuvable.'));
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
        const context = getFavoritesContext(config);

        if ('error' in context) {
            res.send(renderFavoritesPage({rows: [], error: context.error}, hasScreenScraperCredentials(config)));
            return;
        }

        const rows = context.romNames.map(romName => resolveFavoriteRow(context, romName));

        if (!hasScreenScraperCredentials(config)) {
            res.send(renderFavoritesPage({rows}, false));
            return;
        }

        const {marqueePath, flyerPath, logoPath} = context;
        if (!marqueePath || !flyerPath || !logoPath) {
            res.send(renderFavoritesPage({rows}, true));
            return;
        }

        // Stream the page as favorites are processed instead of blocking on the whole batch:
        // each game appends a <li> the browser renders immediately, so long runs stay visible
        // instead of looking like the request (and the tab) hung.
        res.writeHead(200, {'Content-Type': 'text/html; charset=utf-8'});
        // Disable Nagle's algorithm so each res.write() below reaches the browser as soon as
        // it's flushed, instead of being buffered and coalesced with the next one.
        res.socket?.setNoDelay(true);
        res.write(renderPageHead('favorites'));
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

        res.write('<p><a class="button-link" href="/favorites">Retour aux favoris</a></p>');
        res.write(renderPageTail());
        res.end();
    });

    app.get('/import', (req, res) => {
        res.send(renderImportPage());
    });

    app.post('/import', upload.single('pack'), async (req, res) => {
        const config = new Config();
        config.load();

        if (!req.file) {
            res.status(400).send(renderImportPage('Aucun fichier reçu.'));
            return;
        }

        let zip: AdmZip;
        let manifest: StartingPackManifest;
        try {
            zip = new AdmZip(req.file.buffer);
            const manifestEntry = zip.getEntry('manifest.json');
            if (!manifestEntry) {
                throw new Error('manifest.json manquant.');
            }
            manifest = JSON.parse(zip.readAsText(manifestEntry));
            if (manifest.formatVersion !== 1) {
                throw new Error(`version de pack non supportée (${manifest.formatVersion}).`);
            }
        } catch (error) {
            const message = error instanceof Error ? error.message : 'erreur inattendue';
            res.status(422).send(renderImportPage(`ZIP invalide : ${message}`));
            return;
        }

        const iniPath = getMameHomePath();
        const {marqueePath, flyerPath, logoPath, categoryDir} = getMameLocations(iniPath);
        const mameInfo = getMameInfo(config);
        if (!mameInfo.romPath || !marqueePath || !flyerPath || !logoPath || !categoryDir) {
            res.status(422).send(renderImportPage(
                'Configuration MAME incomplète - configurez MAME (onglet MAME) avant d\'importer.',
            ));
            return;
        }

        res.writeHead(200, {'Content-Type': 'text/html; charset=utf-8'});
        res.socket?.setNoDelay(true);
        res.write(renderPageHead('import'));
        res.write('<section class="card"><h2>Import en cours…</h2><ul class="progress-log">');

        try {
            const summary = await importStartingPack(
                zip, manifest, mameInfo.romPath, marqueePath, flyerPath, logoPath, categoryDir, iniPath,
                line => res.write(`<li>${escapeHtml(line)}</li>`),
            );
            res.write('</ul></section>');
            res.write(renderImportSummary(summary));
        } catch (error) {
            console.error('[boServer] Import failed:', error);
            res.write(`</ul><p class="error">${
                escapeHtml(error instanceof Error ? error.message : 'Erreur inattendue.')
            }</p>`);
        }

        res.write('<p><a class="button-link" href="/import">Retour</a></p>');
        res.write(renderPageTail());
        res.end();
    });

    app.get('/maui', (req, res) => {
        const config = new Config();
        config.load();
        res.send(renderMauiPage(config, getMameInfo(config)));
    });

    app.post('/maui/save', (req, res) => {
        const config = new Config();
        config.load();
        config.openDevTools = req.body.openDevTools === 'on';
        config.fullscreen = req.body.fullscreen === 'on';
        config.save();
        res.send(renderMauiPage(config, getMameInfo(config), 'Configuration enregistrée.'));
    });

    app.post('/screenscraper/save', (req, res) => {
        const values: ScreenScraperValues = {
            ssDevId: (req.body.ssDevId || '').trim(),
            ssDevPassword: (req.body.ssDevPassword || '').trim(),
            ssSoftName: (req.body.ssSoftName || '').trim(),
            ssUserId: (req.body.ssUserId || '').trim(),
            ssUserPassword: (req.body.ssUserPassword || '').trim(),
        };

        const config = new Config();
        config.load();
        config.ssDevId = values.ssDevId;
        config.ssDevPassword = values.ssDevPassword;
        config.ssSoftName = values.ssSoftName;
        config.ssUserId = values.ssUserId;
        config.ssUserPassword = values.ssUserPassword;
        config.save();

        res.send(renderScreenScraperPage(values, undefined, 'Configuration ScreenScraper enregistrée.'));
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

        if (!existsSync(mamePath)) {
            res.status(422).send(renderForm(
                {mamePath, isLocal: isLocalhostRequest(req)}, getMameInfo(config), `Le dossier "${mamePath}" n'existe pas.`,
            ));
            return;
        }
        const mameBinaryName = findMameBinary(mamePath);
        if (!mameBinaryName) {
            res.status(422).send(renderForm(
                {mamePath, isLocal: isLocalhostRequest(req)}, getMameInfo(config), `Aucun binaire mame trouvé dans "${mamePath}".`,
            ));
            return;
        }

        try {
            ensureMameConfigBootstrapped(join(mamePath, mameBinaryName), getMameHomePath());
        } catch (error) {
            res.status(422).send(renderForm(
                {mamePath, isLocal: isLocalhostRequest(req)}, getMameInfo(config),
                'Échec de l\'initialisation de mame ("-createconfig") : '
                    + `${error instanceof Error ? error.message : 'erreur inattendue'}.`,
            ));
            return;
        }

        config.mamePath = mamePath;
        config.mameBinaryName = mameBinaryName;
        config.save();

        res.send(renderPage('<section class="card"><h2>Configuration enregistrée</h2><p>'
            + 'L\'application redémarre automatiquement.</p></section>'));

        onConfigured();
    });

    app.post('/launch', (req, res) => {
        const config = new Config();
        config.load();

        if (!isLocalhostRequest(req)) {
            res.status(403).send(renderForm(
                {mamePath: config.mamePath || '', isLocal: false},
                getMameInfo(config),
                'Le lancement de mame n\'est possible que depuis la machine qui héberge mame-awesome-ui.',
            ));
            return;
        }

        if (!config.mamePath || !config.mameBinaryName) {
            res.status(422).send(renderForm(
                {mamePath: config.mamePath || '', isLocal: isLocalhostRequest(req)},
                getMameInfo(config),
                'Aucune configuration valide enregistrée : impossible de lancer mame.',
            ));
            return;
        }

        const mameBinary = join(config.mamePath, config.mameBinaryName);
        if (!existsSync(mameBinary)) {
            res.status(422).send(renderForm(
                {mamePath: config.mamePath, isLocal: isLocalhostRequest(req)},
                getMameInfo(config),
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
            {mamePath: config.mamePath, isLocal: isLocalhostRequest(req)},
            getMameInfo(config),
            undefined,
            'Mame a été lancé, vérifiez qu\'une fenêtre s\'est bien ouverte sur cette machine.',
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
            {mamePath: config.mamePath, isLocal: isLocalhostRequest(req)},
            getMameInfo(config),
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
            {mamePath: config.mamePath, isLocal: isLocalhostRequest(req)},
            getMameInfo(config),
            undefined,
            undefined,
            added
                ? `${added} plugin(s) ajouté(s) à plugin.ini (valeurs par défaut de mame).`
                : 'Rien à réparer : plugin.ini contient déjà tous les plugins détectés (ou aucun plugin trouvé - vérifiez le dossier des plugins ci-dessus).',
        ));
    });

    app.post('/reset', (req, res) => {
        const config = new Config();
        config.load();
        config.delete();

        const deleteDatabase = req.body.deleteDatabase === 'on';

        try {
            rmSync(getMameHomePath(), {recursive: true, force: true});
        } catch (error) {
            console.error('[boServer] Failed to remove mame home directory:', error);
        }

        if (deleteDatabase) {
            try {
                rmSync(getDatabasePath(), {force: true});
            } catch (error) {
                console.error('[boServer] Failed to remove database file:', error);
            }
        }

        res.send(renderPage('<section class="card"><h2>Réinitialisation effectuée</h2>'
            + `<p class="error">Configuration${deleteDatabase ? ', base de données' : ''} et `
            + 'dossier home de mame supprimés. L\'application va se fermer dans un instant.</p>'
            + '<p><strong>Relancez-la manuellement</strong> pour terminer la réinitialisation '
            + '(<code>just serve</code> en développement, ou l\'exécutable habituel en '
            + 'production) - recharger cette page ou l\'application ne suffit pas : le '
            + 'renderer garde en mémoire les services construits sur l\'ancienne configuration '
            + 'tant que le process n\'a pas complètement redémarré.</p></section>', 'maui'));

        // Only closes the app (see onReset in background.ts) - it does NOT relaunch it.
        // Reloading the window to /init (like onConfigured() does after a normal config save)
        // is not enough here: the renderer's Vuex store holds long-lived Config/MameService/
        // GameService instances (see store.ts's initServices) built from the files we just
        // deleted, and only a real process restart clears that in-memory state. Delayed
        // slightly so this response finishes flushing to the browser before the process exits.
        setTimeout(onReset, 300);
    });

    return app.listen(port, () => {
        console.log(`BO server listening on http://localhost:${port}`);
    });
}
