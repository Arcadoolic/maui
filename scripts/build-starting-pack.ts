// Standalone script (run via `just starting-pack`, see package.json's "starting-pack" script)
// that packages the current MAME home's favorites - their metadata, rom files, marquees,
// flyers and favorites.ini - into a single ZIP a fresh install's BO server can import back
// (see the /import route in src/boServer.ts).
//
// Never bundled by webpack and never runs inside Electron, so unlike src/boServer.ts it
// *could* safely import MameService.class.ts/Helpers.class.ts. It deliberately doesn't: this
// repo's convention is that the small mame-ini/path-resolution helpers are duplicated per
// electron-free entry point (see the comments at the top of src/boServer.ts) rather than
// shared, and this script follows the same convention rather than being the one exception.
// Config.class.ts has no Electron dependency and is imported directly, same as boServer.ts.

import {existsSync, readFileSync} from 'fs';
import {join, sep} from 'path';
import * as os from 'os';
import {execFileSync} from 'child_process';
import {parse as iniParse} from 'ini';
import AdmZip from 'adm-zip';
import Config from '../src/class/Config.class';
import {StartingPackGameEntry, StartingPackManifest} from '../src/types/StartingPackManifest';

/**
 * Same directory MameService.class.ts/boServer.ts pin mame's ini/home to - a plain ~/.mame,
 * separate from ~/.mame-awesome-ui (the app's own config/database). Duplicated here for the
 * reason explained at the top of this file.
 */
function getMameHomePath(): string {
    return join(os.homedir(), '.mame');
}

/**
 * Same ini-line parsing MameService.class.ts/boServer.ts use for `-showconfig`/`ui.ini`.
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
 * Same relative-path resolution as Helpers.getFirstExistingDirectory()/boServer.ts's
 * resolveDirectoryPath(): expands $HOME/~, then joins onto parentPath when not absolute.
 */
function resolveDirectoryPath(path: string, parentPath: string): string {
    path = path.replace(/\$HOME|~/, os.homedir());
    if (path[0] === '/') {
        return path;
    }
    parentPath = parentPath.replace('$HOME', os.homedir());
    const parentPathArray = parentPath.split(sep);
    const pathArray = path.split(sep);
    if (parentPathArray[parentPathArray.length - 1] === pathArray[0]) {
        pathArray.shift();
        path = pathArray.join(sep);
    }
    return join(parentPath, path);
}

/**
 * Same directory-resolution logic as Helpers.getFirstExistingDirectory()/boServer.ts: returns
 * the first of `paths` (as declared in an ini file, e.g. mame.ini's rompath) that exists on
 * disk, resolved against `parentPath` when relative, with `file` appended when given.
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
 * Same favorites.ini parsing as MameService.getRomListFromFavorites()/boServer.ts's
 * getFavoriteRomNames().
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

interface PackGameXmlInfo {
    description: string | null;
    biosName: string | null;
    manufacturer: string | null;
    year: string | null;
}

/**
 * Same per-rom `-lx` lookup as MameService.getGameInformation()/boServer.ts's
 * getGameXmlInfo(), extended with manufacturer/year (boServer.ts never needed those).
 */
function getGameXmlInfoForPack(mameBinary: string, iniPath: string, romName: string): PackGameXmlInfo {
    const xmlContent = execFileSync(
        mameBinary,
        ['-lx', romName, '-inipath', iniPath, '-homepath', iniPath],
        {encoding: 'utf8', cwd: iniPath},
    );
    return {
        description: extractXmlTagContent(xmlContent, 'description'),
        biosName: extractXmlAttribute(xmlContent, 'machine', 'romof'),
        manufacturer: extractXmlTagContent(xmlContent, 'manufacturer'),
        year: extractXmlTagContent(xmlContent, 'year'),
    };
}

interface MameLocations {
    uiIni: { [key: string]: string[] };
    marqueePath: string | null;
    flyerPath: string | null;
    logoPath: string | null;
    favoritesPath: string | null;
    genreIniPath: string | null;
    nplayersIniPath: string | null;
}

/**
 * Read-only variant of boServer.ts's getMameLocations(): unlike that one (which creates the
 * marquees/flyers/logos/categorypath directories via ensureFirstDirectory so downloads/imports
 * always have somewhere to land), this script only ever reads from the user's MAME home and
 * must not create anything.
 */
function getMameLocationsReadOnly(iniPath: string): MameLocations {
    const uiIniPath = join(iniPath, 'ui.ini');
    const uiIni = existsSync(uiIniPath) ? parseMameIniFile(readFileSync(uiIniPath, 'utf8')) : {};
    const marqueePath = uiIni.marquees_directory
        ? getFirstExistingDirectory(uiIni.marquees_directory, iniPath) : null;
    const flyerPath = uiIni.flyers_directory
        ? getFirstExistingDirectory(uiIni.flyers_directory, iniPath) : null;
    const logoPath = uiIni.logos_directory
        ? getFirstExistingDirectory(uiIni.logos_directory, iniPath) : null;
    const favoritesPath = uiIni.ui_path
        ? getFirstExistingDirectory(uiIni.ui_path, iniPath, 'favorites.ini') : null;
    // ui.ini's categorypath points at the "folders" directory holding genre.ini/Multiplayer.ini
    // - the real, per-mame-version categorization/player-count datasets (see
    // importStartingPack()'s own comment for why these - not the app's old bundled
    // public/data/genre_206.ini/nplayers_206.ini - are now the source of truth).
    const genreIniPath = uiIni.categorypath
        ? getFirstExistingDirectory(uiIni.categorypath, iniPath, 'genre.ini') : null;
    const nplayersIniPath = uiIni.categorypath
        ? getFirstExistingDirectory(uiIni.categorypath, iniPath, 'Multiplayer.ini') : null;
    return {uiIni, marqueePath, flyerPath, logoPath, favoritesPath, genreIniPath, nplayersIniPath};
}

const nplayersTranslation: { [k: string]: { sim: number; alt: number } } = {
    '12P sim': {sim: 12, alt: 0},
    '1P': {sim: 0, alt: 0},
    '2P alt': {sim: 0, alt: 2},
    '2P sim': {sim: 2, alt: 0},
    '3P alt': {sim: 0, alt: 3},
    '3P sim': {sim: 3, alt: 0},
    '4P alt': {sim: 0, alt: 4},
    '4P alt / 2P sim': {sim: 2, alt: 4},
    '4P sim': {sim: 4, alt: 0},
    '5P alt': {sim: 0, alt: 5},
    '6P alt': {sim: 0, alt: 6},
    '6P alt / 2P sim': {sim: 2, alt: 6},
    '6P sim': {sim: 6, alt: 0},
    '8P alt / 2P sim': {sim: 2, alt: 8},
    '8P sim': {sim: 8, alt: 0},
    '9P alt': {sim: 0, alt: 9},
};

function getGameCategoryName(
    genreIni: { [genre: string]: { [romName: string]: boolean } },
    romName: string,
): string | null {
    for (const category of Object.keys(genreIni)) {
        if (genreIni[category][romName]) {
            return category;
        }
    }
    return null;
}

function getGameNplayers(
    nplayersIni: { [nplayers: string]: { [romName: string]: boolean } },
    romName: string,
): { sim: number; alt: number } {
    for (const nplayers of Object.keys(nplayersIni)) {
        if (nplayersIni[nplayers][romName]) {
            return nplayersTranslation[nplayers] || {sim: 0, alt: 0};
        }
    }
    return {sim: 0, alt: 0};
}

interface CliArgs {
    output: string;
}

function parseArgs(argv: string[]): CliArgs {
    const args: CliArgs = {output: './mame-starting-pack.zip'};
    for (let i = 0; i < argv.length; i++) {
        if (argv[i] === '--output' && argv[i + 1]) {
            args.output = argv[++i];
        }
    }
    return args;
}

function fail(message: string): never {
    console.error(`[build-starting-pack] ${message}`);
    process.exit(1);
}

function main() {
    const args = parseArgs(process.argv.slice(2));
    // Config.class.ts always resolves to <home>/.mame-awesome-ui/mame-awesome-ui-config.json,
    // identically in dev and production - same file the app itself reads/writes.
    const config = new Config();
    config.load();

    if (!config.mamePath || !config.mameBinaryName) {
        fail(`Aucune configuration mame trouvée dans "${config.configPath}". Configurez et `
            + 'lancez mame-awesome-ui au moins une fois.');
    }

    const mameBinary = join(config.mamePath, config.mameBinaryName);
    if (!existsSync(mameBinary)) {
        fail(`Binaire mame introuvable : "${mameBinary}".`);
    }

    const iniPath = getMameHomePath();

    let mameIni: { [key: string]: string[] };
    try {
        const output = execFileSync(
            mameBinary, ['-showconfig', '-inipath', iniPath, '-homepath', iniPath], {cwd: iniPath},
        );
        mameIni = parseMameIniFile(output.toString());
    } catch {
        fail('Impossible de lire la configuration mame ("-showconfig" a échoué).');
    }

    const {
        marqueePath, flyerPath, logoPath, favoritesPath, genreIniPath, nplayersIniPath,
    } = getMameLocationsReadOnly(iniPath);
    if (!favoritesPath) {
        fail('Aucun favori pour l\'instant - ajoutez-en depuis le menu de MAME (Tab en jeu) '
            + 'avant de générer un starting pack.');
    }
    // Both optional: absent (no "folders" pack installed on this MAME version) simply means the
    // pack ships without categories/player counts - importStartingPack() in boServer.ts already
    // tolerates missing genre.ini/Multiplayer.ini entries in the zip.
    if (!genreIniPath) {
        console.warn('[build-starting-pack] genre.ini introuvable (categorypath dans ui.ini) - '
            + 'le pack sera généré sans catégories.');
    }
    if (!nplayersIniPath) {
        console.warn('[build-starting-pack] Multiplayer.ini introuvable (categorypath dans '
            + 'ui.ini) - le pack sera généré sans nombre de joueurs.');
    }

    const romNames = getFavoriteRomNames(favoritesPath);
    if (!romNames.length) {
        fail('favorites.ini ne contient aucun favori.');
    }

    const genreIni: { [genre: string]: { [romName: string]: boolean } } =
        genreIniPath ? iniParse(readFileSync(genreIniPath, 'utf8')) : {};
    const nplayersIni: { [nplayers: string]: { [romName: string]: boolean } } =
        nplayersIniPath ? iniParse(readFileSync(nplayersIniPath, 'utf8')) : {};

    const romPaths = mameIni.rompath || [];
    const zip = new AdmZip();
    const games: StartingPackGameEntry[] = [];
    const biosRomPaths = new Map<string, string>();
    let romsFound = 0;
    let romsMissing = 0;
    let marqueesFound = 0;
    let flyersFound = 0;
    let logosFound = 0;

    for (const romName of romNames) {
        const xmlInfo = getGameXmlInfoForPack(mameBinary, iniPath, romName);
        const fullname = xmlInfo.description || romName;

        let shortname = fullname;
        let subname = '';
        const shortnameMatch = /^(.[^(]*)/g.exec(fullname);
        if (shortnameMatch) {
            shortname = shortnameMatch[0].trim().replace(/&amp;/g, '&');
            const subnameMatch = /^([^\-\/]*)(:\s+|\s+-\s+|\s+\/\s+)(.*)$/.exec(shortname);
            if (subnameMatch) {
                shortname = subnameMatch.splice(0, 3)[1];
                subname = subnameMatch[0];
            }
        }

        const romZipPath = getFirstExistingDirectory(romPaths, iniPath, romName + '.zip');
        if (romZipPath) {
            romsFound++;
            zip.addLocalFile(romZipPath, 'roms');
        } else {
            romsMissing++;
            console.warn(`[build-starting-pack] ROM introuvable pour "${romName}" dans rompath `
                + '- ses métadonnées seront incluses, pas le fichier rom.');
        }

        if (xmlInfo.biosName && !biosRomPaths.has(xmlInfo.biosName)) {
            const biosZipPath = getFirstExistingDirectory(romPaths, iniPath, xmlInfo.biosName + '.zip');
            if (biosZipPath) {
                biosRomPaths.set(xmlInfo.biosName, biosZipPath);
            } else {
                console.warn(`[build-starting-pack] BIOS "${xmlInfo.biosName}" requis par `
                    + `"${romName}" introuvable dans rompath.`);
            }
        }

        const marqueeFile = marqueePath ? join(marqueePath, romName + '.png') : null;
        const flyerFile = flyerPath ? join(flyerPath, romName + '.png') : null;
        const logoFile = logoPath ? join(logoPath, romName + '.png') : null;
        const hasMarquee = !!marqueeFile && existsSync(marqueeFile);
        const hasFlyer = !!flyerFile && existsSync(flyerFile);
        const hasLogo = !!logoFile && existsSync(logoFile);
        if (hasMarquee) {
            marqueesFound++;
            zip.addLocalFile(marqueeFile!, 'marquees');
        }
        if (hasFlyer) {
            flyersFound++;
            zip.addLocalFile(flyerFile!, 'flyers');
        }
        if (hasLogo) {
            logosFound++;
            zip.addLocalFile(logoFile!, 'logos');
        }

        const players = getGameNplayers(nplayersIni, romName);
        games.push({
            romName,
            fullname,
            shortname,
            subname,
            manufacturer: xmlInfo.manufacturer,
            year: xmlInfo.year,
            categoryName: getGameCategoryName(genreIni, romName),
            player_alt: players.alt,
            player_sim: players.sim,
            biosName: xmlInfo.biosName,
            hasRomFile: !!romZipPath,
            hasMarquee,
            hasFlyer,
            hasLogo,
        });

        console.log(`[build-starting-pack] ${romName} : ${fullname}`);
    }

    for (const biosZipPath of biosRomPaths.values()) {
        zip.addLocalFile(biosZipPath, 'roms');
    }

    const manifest: StartingPackManifest = {
        formatVersion: 1,
        generatedAt: new Date().toISOString(),
        games,
        biosRoms: [...biosRomPaths.keys()],
    };
    zip.addFile('manifest.json', Buffer.from(JSON.stringify(manifest, null, 2), 'utf8'));
    zip.addFile('favorites.ini', readFileSync(favoritesPath));
    // Bundled when available so an import can install them too (see importStartingPack() in
    // boServer.ts) - omitted entirely when absent on this source MAME install, which
    // importStartingPack() already tolerates (warns, doesn't fail the import).
    if (genreIniPath) {
        zip.addFile('genre.ini', readFileSync(genreIniPath));
    }
    if (nplayersIniPath) {
        zip.addFile('Multiplayer.ini', readFileSync(nplayersIniPath));
    }

    zip.writeZip(args.output);

    console.log(`[build-starting-pack] Terminé -> ${args.output}`);
    console.log(`[build-starting-pack] ${games.length} jeu(x), ${romsFound} rom(s) `
        + `(${romsMissing} manquante(s)), ${biosRomPaths.size} bios, ${marqueesFound} marquee(s), `
        + `${flyersFound} flyer(s), ${logosFound} logo(s).`);
}

main();
