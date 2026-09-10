import express from 'express';
import {Server} from 'http';
import {existsSync, mkdirSync, readdirSync, readFileSync} from 'fs';
import {join, dirname, sep} from 'path';
import * as os from 'os';
import {execFile, execFileSync} from 'child_process';
import Config from '@/class/Config.class';
import ScreenScraperClient, {ScreenScraperCredentials} from '@/class/ScreenScraperClient.class';

declare const __static: string;

type PathField = 'mamePath' | 'avatarsPath';
type Tab = 'mame' | 'screenscraper' | 'favorites';

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
 * Same directory MameService pins mame's ini/home to (see Helpers.getMameHomePath()).
 * Duplicated here rather than imported: Helpers.class.ts pulls in the renderer-only
 * @electron/remote at module scope, which isn't safe to load in the main process bundle.
 */
function getMameHomePath(): string {
    const homePath = join(os.homedir(), '.mame-awesome-ui', 'mame-home');
    if (!existsSync(homePath)) {
        mkdirSync(homePath, {recursive: true});
    }
    return homePath;
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
 * Resolves the directories/file ui.ini points mame-awesome-ui at: marquees, flyers
 * (created if missing, see ensureFirstDirectory) and favorites.ini (never created -
 * mame itself writes it the first time a favorite is added).
 */
interface MameLocations {
    uiIni: { [key: string]: string[] };
    marqueePath: string | null;
    flyerPath: string | null;
    favoritesPath: string | null;
}

function getMameLocations(iniPath: string): MameLocations {
    const uiIniPath = join(iniPath, 'ui.ini');
    const uiIni = existsSync(uiIniPath) ? parseMameIniFile(readFileSync(uiIniPath, 'utf8')) : {};
    const marqueePath = ensureFirstDirectory(uiIni.marquees_directory, iniPath);
    const flyerPath = ensureFirstDirectory(uiIni.flyers_directory, iniPath);
    const favoritesPath = uiIni.ui_path ? getFirstExistingDirectory(uiIni.ui_path, iniPath, 'favorites.ini') : null;
    return {uiIni, marqueePath, flyerPath, favoritesPath};
}

interface MameInfo {
    iniPath: string;
    mameIniPath: string;
    uiIniPath: string;
    romPath: string | null;
    marqueePath: string | null;
    flyerPath: string | null;
    favoritesPath: string | null;
    error?: string;
}

function getMameInfo(config: Config): MameInfo {
    const iniPath = getMameHomePath();
    const mameIniPath = join(iniPath, 'mame.ini');
    const uiIniPath = join(iniPath, 'ui.ini');
    const {marqueePath, flyerPath, favoritesPath} = getMameLocations(iniPath);

    if (!config.mamePath || !config.mameBinaryName) {
        return {
            iniPath, mameIniPath, uiIniPath, romPath: null, marqueePath, flyerPath, favoritesPath,
            error: 'Configurez le binaire mame ci-dessus pour voir le chemin des roms.',
        };
    }

    const mameBinary = join(config.mamePath, config.mameBinaryName);
    if (!existsSync(mameBinary)) {
        return {
            iniPath, mameIniPath, uiIniPath, romPath: null, marqueePath, flyerPath, favoritesPath,
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
        return {iniPath, mameIniPath, uiIniPath, romPath, marqueePath, flyerPath, favoritesPath};
    } catch {
        return {
            iniPath, mameIniPath, uiIniPath, romPath: null, marqueePath, flyerPath, favoritesPath,
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

/**
 * Same per-rom lookup as MameService.getGameInformation(), but with regex tag extraction
 * instead of DOMParser: DOMParser is a browser global available in the renderer, not in
 * this main-process server.
 */
function getGameDescription(mameBinary: string, iniPath: string, romName: string): string | null {
    try {
        const xmlContent = execFileSync(
            mameBinary,
            ['-lx', romName, '-inipath', iniPath, '-homepath', iniPath],
            {encoding: 'utf8', cwd: iniPath},
        );
        return extractXmlTagContent(xmlContent, 'description');
    } catch {
        return null;
    }
}

interface FavoriteRow {
    romName: string;
    fullname: string;
    hasMarquee: boolean;
    hasFlyer: boolean;
}

interface FavoritesInfo {
    rows: FavoriteRow[];
    error?: string;
}

function getFavoritesInfo(config: Config): FavoritesInfo {
    const iniPath = getMameHomePath();
    const {marqueePath, flyerPath, favoritesPath} = getMameLocations(iniPath);

    if (!favoritesPath) {
        return {
            rows: [],
            error: 'Aucun favori pour l\'instant - ajoutez-en depuis le menu de MAME (Tab en jeu).',
        };
    }

    const romNames = getFavoriteRomNames(favoritesPath);
    if (!romNames.length) {
        return {
            rows: [],
            error: 'Le fichier favorites.ini ne contient aucun favori pour l\'instant.',
        };
    }

    if (!config.mamePath || !config.mameBinaryName) {
        return {
            rows: [],
            error: 'Configurez le binaire mame dans l\'onglet MAME pour afficher le nom des favoris.',
        };
    }
    const mameBinary = join(config.mamePath, config.mameBinaryName);
    if (!existsSync(mameBinary)) {
        return {rows: [], error: `Le binaire "${mameBinary}" est introuvable.`};
    }

    const rows: FavoriteRow[] = romNames.map((romName) => {
        const description = getGameDescription(mameBinary, iniPath, romName);
        return {
            romName,
            fullname: description || romName,
            hasMarquee: !!marqueePath && existsSync(join(marqueePath, romName + '.png')),
            hasFlyer: !!flyerPath && existsSync(join(flyerPath, romName + '.png')),
        };
    });

    return {rows};
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
 * Downloads the missing marquee/flyer for every favorite that doesn't already have both.
 * Never re-fetches a game whose marquee AND flyer are both already on disk - the ScreenScraper
 * call is skipped entirely for those, to keep API usage to the minimum needed.
 */
async function downloadMissingFavoriteMedia(
    credentials: ScreenScraperCredentials,
    marqueePath: string,
    flyerPath: string,
    rows: FavoriteRow[],
): Promise<DownloadSummary> {
    const summary: DownloadSummary = {
        alreadyComplete: 0, downloaded: 0, notFound: 0, noMedia: 0, errors: [], stoppedForQuota: false,
    };
    const client = new ScreenScraperClient(credentials);

    for (const row of rows) {
        if (row.hasMarquee && row.hasFlyer) {
            summary.alreadyComplete++;
            continue;
        }

        const result = await client.fetchGameMedia(row.romName);

        if (result.status === 'quota-exceeded') {
            summary.stoppedForQuota = true;
            summary.errors.push(`${row.romName}: quota ScreenScraper dépassé, arrêt du traitement.`);
            break;
        }
        if (result.status === 'not-found') {
            summary.notFound++;
            continue;
        }
        if (result.status === 'error') {
            summary.errors.push(`${row.romName}: ${result.message}`);
            continue;
        }

        let attempted = false;
        if (!row.hasMarquee && result.media.marqueeUrl) {
            attempted = true;
            const download = await client.downloadMedia(
                result.media.marqueeUrl, join(marqueePath, row.romName + '.png'), 'marquee',
            );
            if (download.status === 'ok') {
                summary.downloaded++;
            } else {
                summary.errors.push(`${row.romName}: ${download.message}`);
            }
        }
        if (!row.hasFlyer && result.media.flyerUrl) {
            attempted = true;
            const download = await client.downloadMedia(
                result.media.flyerUrl, join(flyerPath, row.romName + '.png'), 'flyer',
            );
            if (download.status === 'ok') {
                summary.downloaded++;
            } else {
                summary.errors.push(`${row.romName}: ${download.message}`);
            }
        }
        if (!attempted) {
            // Found on ScreenScraper, but no marquee/flyer available for it (e.g. a
            // "notgame" driver entry like a BIOS/device, or media simply not uploaded yet).
            summary.noMedia++;
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

function renderPage(body: string, active: Tab = 'mame'): string {
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
            max-width: 560px;
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
    </style>
</head>
<body>
    <header>
        <h1>mame-awesome-ui</h1>
        <nav class="tabs">
            <a href="/" class="${active === 'mame' ? 'active' : ''}">MAME</a>
            <a href="/favorites" class="${active === 'favorites' ? 'active' : ''}">Favoris</a>
            <a href="/screenscraper" class="${active === 'screenscraper' ? 'active' : ''}">ScreenScraper</a>
        </nav>
    </header>
    ${body}
</body>
</html>`;
}

function renderConfigCard(values: {mamePath: string, avatarsPath: string}, error?: string, info?: string): string {
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
                <label for="avatarsPath">Dossier des avatars utilisateurs</label>
                <div class="path-row">
                    <input type="text" id="avatarsPath" name="avatarsPath" value="${escapeHtml(values.avatarsPath)}">
                    <button type="submit" name="target" value="avatarsPath" formaction="/browse" formmethod="get">Parcourir</button>
                </div>
                <button type="submit">Enregistrer</button>
            </form>
        </section>
    `;
}

function renderMameInfoCard(mameInfo: MameInfo): string {
    return `
        <section class="card">
            <h2>Informations MAME</h2>
            ${mameInfo.error ? `<p class="error">${escapeHtml(mameInfo.error)}</p>` : ''}
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
                    <dt>Fichier des favoris (favorites.ini)</dt>
                    <dd>${mameInfo.favoritesPath
                        ? escapeHtml(mameInfo.favoritesPath)
                        : '<em>Aucun favori pour l\'instant — ajoutez-en depuis le menu de MAME (Tab en jeu).</em>'}</dd>
                </div>
            </dl>
        </section>
    `;
}

function renderActionsCard(): string {
    return `
        <section class="card">
            <h2>Actions</h2>
            <form method="post" action="/launch">
                <button type="submit">Lancer mame</button>
            </form>
        </section>
    `;
}

function renderForm(
    values: {mamePath: string, avatarsPath: string},
    mameInfo: MameInfo,
    error?: string,
    info?: string,
): string {
    return renderPage(
        renderConfigCard(values, error, info)
        + renderMameInfoCard(mameInfo)
        + renderActionsCard(),
        'mame',
    );
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
            <td>${escapeHtml(row.fullname)}</td>
            <td class="center">${renderFavoriteBadge(row.hasMarquee)}</td>
            <td class="center">${renderFavoriteBadge(row.hasFlyer)}</td>
        </tr>
    `).join('');

    const downloadSection = hasCreds
        ? `
            ${summary ? renderDownloadSummary(summary) : ''}
            <form method="post" action="/favorites/download-media">
                <p class="info">Télécharge les marquees/flyers manquants depuis ScreenScraper pour les favoris
                ci-dessous. Traitement synchrone, peut prendre plusieurs minutes selon le nombre de favoris
                (délai imposé entre chaque appel) - ne fermez pas cette page pendant le téléchargement.</p>
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
                            <th class="center">Marquee</th>
                            <th class="center">Flyer</th>
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

function renderBrowsePage(target: PathField, currentDir: string, formValues: {mamePath: string, avatarsPath: string}): string {
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
    const carryQuery = `mamePath=${encodeURIComponent(formValues.mamePath)}&avatarsPath=${encodeURIComponent(formValues.avatarsPath)}`;
    const navLink = (dir: string) => `/browse?target=${target}&path=${encodeURIComponent(dir)}&${carryQuery}`;
    const selectLink = (dir: string) => {
        const selected = {...formValues, [target]: dir};
        return `/?mamePath=${encodeURIComponent(selected.mamePath)}&avatarsPath=${encodeURIComponent(selected.avatarsPath)}`;
    };

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

export function startBoServer(userDataPath: string, port: number, onConfigured: () => void): Server {
    const app = express();
    app.use(express.urlencoded({extended: false}));

    app.get('/background.jpg', (req, res) => {
        res.sendFile(join(__static, 'img/background.jpg'));
    });

    app.get('/', (req, res) => {
        const config = new Config(userDataPath);
        config.load();
        const mamePath = typeof req.query.mamePath === 'string' ? req.query.mamePath : (config.mamePath || '');
        const avatarsPath = typeof req.query.avatarsPath === 'string' ? req.query.avatarsPath : (config.avatarsPath || '');
        res.send(renderForm({mamePath, avatarsPath}, getMameInfo(config)));
    });

    app.get('/screenscraper', (req, res) => {
        const config = new Config(userDataPath);
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
        const config = new Config(userDataPath);
        config.load();
        res.send(renderFavoritesPage(getFavoritesInfo(config), hasScreenScraperCredentials(config)));
    });

    app.post('/favorites/download-media', async (req, res) => {
        const config = new Config(userDataPath);
        config.load();

        if (!hasScreenScraperCredentials(config)) {
            res.send(renderFavoritesPage(getFavoritesInfo(config), false));
            return;
        }

        try {
            const iniPath = getMameHomePath();
            const {marqueePath, flyerPath} = getMameLocations(iniPath);
            const favoritesInfo = getFavoritesInfo(config);

            if (favoritesInfo.error || !marqueePath || !flyerPath) {
                res.send(renderFavoritesPage(favoritesInfo, true));
                return;
            }

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
                favoritesInfo.rows,
            );

            // Re-read so the badges reflect the files just written to disk.
            res.send(renderFavoritesPage(getFavoritesInfo(config), true, summary));
        } catch (error) {
            console.error('[boServer] ScreenScraper download failed:', error);
            res.send(renderFavoritesPage(
                getFavoritesInfo(config),
                true,
                {
                    alreadyComplete: 0, downloaded: 0, notFound: 0, stoppedForQuota: false,
                    errors: [error instanceof Error ? error.message : 'Erreur inattendue.'],
                },
            ));
        }
    });

    app.post('/screenscraper/save', (req, res) => {
        const values: ScreenScraperValues = {
            ssDevId: (req.body.ssDevId || '').trim(),
            ssDevPassword: (req.body.ssDevPassword || '').trim(),
            ssSoftName: (req.body.ssSoftName || '').trim(),
            ssUserId: (req.body.ssUserId || '').trim(),
            ssUserPassword: (req.body.ssUserPassword || '').trim(),
        };

        const config = new Config(userDataPath);
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
        const target: PathField = req.query.target === 'avatarsPath' ? 'avatarsPath' : 'mamePath';
        const formValues = {
            mamePath: typeof req.query.mamePath === 'string' ? req.query.mamePath : '',
            avatarsPath: typeof req.query.avatarsPath === 'string' ? req.query.avatarsPath : '',
        };

        let currentDir = typeof req.query.path === 'string' && req.query.path ? req.query.path : formValues[target];
        if (!currentDir || !existsSync(currentDir)) {
            const config = new Config(userDataPath);
            config.load();
            currentDir = (target === 'mamePath' ? config.mamePath : config.avatarsPath) || os.homedir();
        }
        if (!existsSync(currentDir)) {
            currentDir = os.homedir();
        }

        res.send(renderBrowsePage(target, currentDir, formValues));
    });

    app.post('/save', (req, res) => {
        const mamePath: string = (req.body.mamePath || '').trim();
        const avatarsPath: string = (req.body.avatarsPath || '').trim();
        const config = new Config(userDataPath);

        if (!existsSync(mamePath)) {
            res.status(422).send(renderForm(
                {mamePath, avatarsPath}, getMameInfo(config), `Le dossier "${mamePath}" n'existe pas.`,
            ));
            return;
        }
        const mameBinaryName = findMameBinary(mamePath);
        if (!mameBinaryName) {
            res.status(422).send(renderForm(
                {mamePath, avatarsPath}, getMameInfo(config), `Aucun binaire mame trouvé dans "${mamePath}".`,
            ));
            return;
        }

        try {
            if (!existsSync(avatarsPath)) {
                mkdirSync(avatarsPath, {recursive: true});
            }
        } catch {
            res.status(422).send(renderForm(
                {mamePath, avatarsPath}, getMameInfo(config), `Impossible de créer le dossier "${avatarsPath}".`,
            ));
            return;
        }

        config.mamePath = mamePath;
        config.mameBinaryName = mameBinaryName;
        config.avatarsPath = avatarsPath;
        config.save();

        res.send(renderPage('<section class="card"><h2>Configuration enregistrée</h2><p>'
            + 'L\'application redémarre automatiquement.</p></section>'));

        onConfigured();
    });

    app.post('/launch', (req, res) => {
        const config = new Config(userDataPath);
        config.load();

        if (!config.mamePath || !config.mameBinaryName) {
            res.status(422).send(renderForm(
                {mamePath: config.mamePath || '', avatarsPath: config.avatarsPath || ''},
                getMameInfo(config),
                'Aucune configuration valide enregistrée : impossible de lancer mame.',
            ));
            return;
        }

        const mameBinary = join(config.mamePath, config.mameBinaryName);
        if (!existsSync(mameBinary)) {
            res.status(422).send(renderForm(
                {mamePath: config.mamePath, avatarsPath: config.avatarsPath},
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
            {mamePath: config.mamePath, avatarsPath: config.avatarsPath},
            getMameInfo(config),
            undefined,
            'Mame a été lancé, vérifiez qu\'une fenêtre s\'est bien ouverte sur cette machine.',
        ));
    });

    return app.listen(port, () => {
        console.log(`BO server listening on http://localhost:${port}`);
    });
}
