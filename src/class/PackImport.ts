import {createWriteStream, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statfsSync, writeFileSync} from 'fs';
import {dirname, resolve, sep} from 'path';
import {Readable, Transform} from 'stream';
import {pipeline} from 'stream/promises';
import {crc32, createInflateRaw, inflateRawSync} from 'zlib';
import type {StartingPackFileEntry, StartingPackGameEntry, StartingPackManifest} from '@/types/StartingPackManifest';
import {getRequiredRoms} from '@/class/PackOwnership';
import type {RomVerdict} from '@/class/MameVerifyRoms';

/**
 * Import of a pack of the repository. The pack's companion manifest says where each of its files
 * sits in the ZIP (`files`, written by the repository), so the files wanted are fetched with
 * HTTP Range requests and inflated here - no ZIP library, and nothing of the ZIP read beyond
 * those files. scripts/import-starting-pack.py does the same from a local ZIP, by hand, on a
 * machine with python3: the app neither ships nor runs it, and the two must be kept alike - but
 * for the check of the sets by the installed MAME (findIncompatibleGames()), done here only.
 *
 * Electron-free and without a database of its own: where the files go (PackImportTargets) and
 * how a game is saved (PackGameStore) come from the caller, src/boServer.ts.
 */

// Each zip top-level folder maps to
// the mame.ini/ui.ini key that resolves its real destination on this mame home.
const IMPORTABLE_MAME_DIRECTORIES: ReadonlyArray<readonly [string, string]> = [
    ['cfg', 'cfg_directory'],
    ['nvram', 'nvram_directory'],
    ['diff', 'diff_directory'],
    ['comments', 'comment_directory'],
    ['inp', 'input_directory'],
    ['sta', 'state_directory'],
    ['snap', 'snapshot_directory'],
    ['folders', 'categorypath'],
    // Sample sets of the pack games (manifest sampleSet), one zip per set, narrowed with `only`.
    ['samples', 'samplepath'],
];

// Loose files at the root of the ZIP, installed in the mame home: mame runs from there, and its
// hiscore plugin reads a hiscore.dat from its current directory before its own copy. The
// configuration pack ships a corrected hiscore.dat this way.
const IMPORTABLE_ROOT_FILES = ['hiscore.dat'];

// Zip folders holding one file per game: what `only` narrows down.
const PER_GAME_FOLDERS = ['roms', 'marquees', 'flyers', 'logos', 'samples'];

// Files next to each other in the ZIP are fetched together, up to this much per request: a pack
// is hundreds of small files, and each request is checked against MAUI-API by the repository.
const GROUP_MAX_BYTES = 8 * 1024 * 1024;
// Local headers (and the files nobody asked for) between two wanted files: worth downloading
// rather than opening another request, up to this much.
const GROUP_MAX_GAP = 64 * 1024;
const REQUEST_RETRIES = 3;
const REQUEST_TIMEOUT_MS = 60_000;
const PROGRESS_INTERVAL_MS = 250;

const FAVORITES_HEADER = '[ROOT_FOLDER]\n[Favorite]\n\n';
const FAVORITE_ROM_NAME_REGEX = /^(?![0-9]$)[a-z0-9]+$/;
const ROM_INFOS_FIELDS = ['publisher', 'publisherId', 'developer', 'developerId'] as const;

export interface PackImportSummary {
    gamesUpserted: number;
    romFilesWritten: number;
    biosFilesWritten: number;
    marqueesWritten: number;
    flyersWritten: number;
    logosWritten: number;
    favoritesAdded: number;
    romsInfosAdded: number;
    // Games left out: the installed MAME cannot run the set the pack has for them.
    incompatibleGames: string[];
    categoriesCreated: string[];
    directoriesImported: {zipFolder: string; filesWritten: number}[];
    warnings: string[];
    errors: string[];
}

export interface PackImportReporter {
    line(text: string): void;
    // total 0 = unknown.
    progress(phase: 'download' | 'import', done: number, total: number): void;
}

export interface PackGameFields {
    id_category: number | null;
    fullname: string | null;
    shortname: string | null;
    subname: string | null;
    manufacturer: string | null;
    year: number | null;
    hi: boolean;
    player_alt: number;
    player_sim: number;
}

export interface PackGameStore {
    findOrCreateCategory(name: string): Promise<{id: number; created: boolean}>;
    // Restores a soft-deleted game rather than colliding with it: its romName is still taken.
    upsertGame(romName: string, fields: PackGameFields): Promise<void>;
}

export interface PackImportTargets {
    // The mame home, where the root files go.
    iniPath: string;
    romPath: string | null;
    marqueePath: string | null;
    flyerPath: string | null;
    logoPath: string | null;
    categoryDir: string | null;
    romsInfosCachePath: string;
    // Destination of a mame.ini/ui.ini directory key (cfg_directory, samplepath...), created if
    // missing; null when the mame configuration does not have it.
    directoryFor(iniKey: string): string | null;
    // Where favorites.ini is, or is to be written. Throws when ui.ini has no ui_path.
    favoritesPath(): string;
}

export interface PackImportOptions {
    // URL of the pack's ZIP.
    url: string;
    headers: Record<string, string>;
    // The pack's companion manifest, as fetched.
    companion: unknown;
    // romNames to restrict the import to; absent = the whole pack.
    only?: string[];
    targets: PackImportTargets;
    store: PackGameStore;
    reporter: PackImportReporter;
    // The installed MAME's verdict on sets now in the rompath (MameVerifyRoms.verifyRoms()); null
    // when it could not be asked. Absent = no check, every game of the pack is imported.
    verifyRoms?: (romNames: string[]) => Promise<ReadonlyMap<string, RomVerdict> | null>;
    fetchImpl?: typeof fetch;
}

/** An import that cannot go on: reported as one line, nothing more is written. */
export class PackImportError extends Error {}

export interface DescribedPack {
    zipSize: number;
    files: StartingPackFileEntry[];
    // null for a pack without games (the configuration pack: folders only).
    manifest: StartingPackManifest | null;
}

const isSize = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;

function isFileEntry(value: unknown): value is StartingPackFileEntry {
    const file = value as Partial<StartingPackFileEntry> | null;
    return !!file && typeof file.name === 'string' && isSize(file.offset) && isSize(file.compressedSize)
        && isSize(file.size) && (file.method === 0 || file.method === 8) && isSize(file.crc32);
}

/**
 * What a companion manifest says of its pack, when it says where the files are: null for one
 * written before the repository did (or for a ZIP it could not describe) - the app cannot import
 * that pack by itself. Throws PackImportError for a pack whose own manifest.json the repository
 * could not read: its games are unknown, importing its folders alone would look like a success.
 */
export function describePack(companion: unknown): DescribedPack | null {
    const pack = companion as (Partial<StartingPackManifest> & {note?: unknown}) | null;
    if (!pack || typeof pack !== 'object' || !Array.isArray(pack.files) || !isSize(pack.zip?.size)) {
        return null;
    }
    if (!pack.files.every(isFileEntry)) {
        return null;
    }
    const files = pack.files.filter(file => !file.name.endsWith('/'));
    if (pack.formatVersion === 1 && Array.isArray(pack.games)) {
        return {zipSize: pack.zip.size, files, manifest: pack as StartingPackManifest};
    }
    if (files.some(file => file.name === 'manifest.json')) {
        throw new PackImportError(`Invalid pack: ${typeof pack.note === 'string' ? pack.note : 'unsupported manifest.json'}.`);
    }
    return {zipSize: pack.zip.size, files, manifest: null};
}

export function humanSize(bytes: number): string {
    let size = bytes;
    for (const unit of ['B', 'KiB', 'MiB', 'GiB']) {
        if (size < 1024) {
            return `${size.toFixed(1)} ${unit}`;
        }
        size /= 1024;
    }
    return `${size.toFixed(1)} TiB`;
}

function defaultSummary(): PackImportSummary {
    return {
        gamesUpserted: 0, romFilesWritten: 0, biosFilesWritten: 0, marqueesWritten: 0, flyersWritten: 0,
        logosWritten: 0, favoritesAdded: 0, romsInfosAdded: 0, incompatibleGames: [], categoriesCreated: [], directoriesImported: [],
        warnings: [], errors: [],
    };
}

/**
 * Copy of `manifest` restricted to the games named in `only` (romNames), keeping the pack's
 * order: the import then needs no idea of `only` at all. Only the sets those games need stay in
 * biosRoms. Names the pack does not contain are warnings, not errors: the BO builds the list
 * from the manifest, so it can only differ if the pack changed meanwhile.
 */
export function selectGames(manifest: StartingPackManifest, only: readonly string[], summary: PackImportSummary): StartingPackManifest {
    const wanted = new Set(only);
    const games = manifest.games.filter(game => wanted.has(game.romName));
    const found = new Set(games.map(game => game.romName));
    [...wanted].filter(name => !found.has(name)).sort().forEach((name) => {
        summary.warnings.push(`${name}: not in this pack, skipped.`);
    });
    const neededBios = new Set(games.flatMap(getRequiredRoms));
    const neededSamples = new Set(games.map(game => game.sampleSet).filter(Boolean));
    return {
        ...manifest,
        games,
        biosRoms: (manifest.biosRoms ?? []).filter(name => neededBios.has(name)),
        sampleSets: (manifest.sampleSets ?? []).filter(name => neededSamples.has(name)),
    };
}

/** Names of the per-game zip entries the (already restricted) manifest asks for. */
export function wantedEntries(manifest: StartingPackManifest): Set<string> {
    const entries = new Set<string>();
    for (const game of manifest.games) {
        if (game.hasRomFile) {
            entries.add(`roms/${game.romName}.zip`);
        }
        if (game.hasMarquee) {
            entries.add(`marquees/${game.romName}.png`);
        }
        if (game.hasFlyer) {
            entries.add(`flyers/${game.romName}.png`);
        }
        if (game.hasLogo) {
            entries.add(`logos/${game.romName}.png`);
        }
        if (game.sampleSet) {
            entries.add(`samples/${game.sampleSet}.zip`);
        }
    }
    (manifest.biosRoms ?? []).forEach(name => entries.add(`roms/${name}.zip`));
    return entries;
}

interface PlannedFile {
    entry: StartingPackFileEntry;
    // The directory this file is installed under, and the file itself.
    root: string;
    destination: string;
}

/**
 * Where a zip entry lands under `root`: null when its path would resolve outside (zip-slip, via
 * a `../` segment) or on `root` itself.
 */
function destinationUnder(root: string, relative: string): string | null {
    const resolvedRoot = resolve(root);
    const destination = resolve(resolvedRoot, relative);
    return destination.startsWith(resolvedRoot + sep) ? destination : null;
}

/**
 * Aborts with every undersized destination, before any file is written: a pack filling up a Pi's
 * SD card halfway through (half the roms, a truncated favorites.ini) is worse than a refusal.
 */
function checkDiskSpace(plan: readonly PlannedFile[]): void {
    const needed = new Map<string, number>();
    for (const file of plan) {
        needed.set(file.root, (needed.get(file.root) ?? 0) + file.entry.size);
    }
    const problems: string[] = [];
    for (const [root, size] of needed) {
        let free: number;
        try {
            const stats = statfsSync(root);
            free = stats.bavail * stats.bsize;
        } catch {
            continue;
        }
        // +5% margin: many small files cost more in filesystem blocks than their byte total.
        if (size * 1.05 > free) {
            problems.push(`${root}: about ${humanSize(size)} needed, ${humanSize(free)} available.`);
        }
    }
    if (problems.length) {
        throw new PackImportError(`Not enough disk space:\n  ${problems.join('\n  ')}`);
    }
}

/** The repository relays MAUI-API's refusals as problem+json: show their stable `code`. */
async function describeHttpError(response: Response): Promise<string> {
    let code: unknown;
    try {
        code = (await response.json() as {code?: unknown}).code;
    } catch {
        code = null;
    }
    return typeof code === 'string'
        ? `HTTP ${response.status}, refused by MAUI-API (${code})`
        : `HTTP ${response.status} ${response.statusText}`.trim();
}

function writeFileAtomically(destination: string, data: Buffer): void {
    mkdirSync(dirname(destination), {recursive: true});
    const part = `${destination}.part`;
    writeFileSync(part, data);
    renameSync(part, destination);
}

/** Fetches files of a pack out of its ZIP, by the positions its manifest gives. */
class PackDownloader {
    private downloaded = 0;
    private lastProgress = 0;
    private readonly total: number;

    constructor(
        private readonly url: string, private readonly headers: Record<string, string>,
        private readonly zipSize: number, private readonly plan: readonly PlannedFile[],
        private readonly reporter: PackImportReporter, private readonly fetchImpl: typeof fetch,
    ) {
        this.total = plan.reduce((sum, file) => sum + file.entry.compressedSize, 0);
    }

    /**
     * Installs every planned file. The result gives, by entry name, null once written or why it
     * was not. Throws PackImportError when the repository itself fails (refusal, no range
     * support, a pack re-published since its manifest, network down): the next file would too.
     */
    public async run(): Promise<Map<string, string | null>> {
        const results = new Map<string, string | null>();
        this.reporter.progress('download', 0, this.total);
        for (const group of this.groups()) {
            const first = group[0].entry;
            if (group.length === 1 && first.compressedSize > GROUP_MAX_BYTES) {
                results.set(first.name, await this.attempt(() => this.streamFile(group[0])));
                continue;
            }
            const last = group[group.length - 1].entry;
            const start = first.offset;
            const length = last.offset + last.compressedSize - start;
            const data = length ? await this.retry(async () => {
                const response = await this.request(start, length, AbortSignal.timeout(REQUEST_TIMEOUT_MS));
                return Buffer.from(await response.arrayBuffer());
            }) : Buffer.alloc(0);
            if (data.length !== length) {
                throw new PackImportError('Download failed: the repository sent less than what was asked.');
            }
            for (const file of group) {
                const {entry} = file;
                results.set(entry.name, await this.attempt(async () => {
                    const raw = data.subarray(entry.offset - start, entry.offset - start + entry.compressedSize);
                    const content = entry.method === 8 ? inflateRawSync(raw, {maxOutputLength: entry.size + 1}) : raw;
                    if (content.length !== entry.size || crc32(content) !== entry.crc32) {
                        throw new Error('does not match the pack manifest (pack re-published?).');
                    }
                    writeFileAtomically(file.destination, content);
                }));
                this.advance(entry.compressedSize);
            }
        }
        this.reporter.progress('download', this.total, this.total);
        return results;
    }

    /** The plan in the ZIP's order, cut into runs of neighbours small enough for one request. */
    private groups(): PlannedFile[][] {
        const groups: PlannedFile[][] = [];
        let current: PlannedFile[] = [];
        let start = 0;
        let end = 0;
        for (const file of [...this.plan].sort((a, b) => a.entry.offset - b.entry.offset)) {
            const fileEnd = file.entry.offset + file.entry.compressedSize;
            const fits = current.length > 0 && file.entry.offset >= end
                && file.entry.offset - end <= GROUP_MAX_GAP && fileEnd - start <= GROUP_MAX_BYTES;
            if (!fits) {
                current = [];
                groups.push(current);
                start = file.entry.offset;
            }
            current.push(file);
            end = fileEnd;
        }
        return groups;
    }

    /** One file's failure does not stop the others; the repository's does (PackImportError). */
    private async attempt(action: () => Promise<void>): Promise<string | null> {
        try {
            await action();
            return null;
        } catch (error) {
            if (error instanceof PackImportError) {
                throw error;
            }
            return error instanceof Error && error.message ? error.message : 'unexpected error';
        }
    }

    /** A request that fails on the network is tried again a few times before giving up. */
    private async retry<T>(action: () => Promise<T>): Promise<T> {
        let lastError: unknown;
        for (let tries = 0; tries < REQUEST_RETRIES; tries++) {
            try {
                return await action();
            } catch (error) {
                if (error instanceof PackImportError) {
                    throw error;
                }
                lastError = error;
            }
        }
        throw new PackImportError(`Download failed: ${lastError instanceof Error ? lastError.message : 'network error'}`);
    }

    private async request(start: number, length: number, signal: AbortSignal): Promise<Response> {
        const response = await this.fetchImpl(this.url, {
            headers: {...this.headers, Range: `bytes=${start}-${start + length - 1}`},
            // The headers carry the cabinet token: never follow a redirect elsewhere.
            redirect: 'error',
            signal,
        });
        if (response.status !== 206) {
            const reason = response.status === 200
                ? 'the repository does not support HTTP Range requests.'
                : await describeHttpError(response);
            await response.body?.cancel().catch(() => undefined);
            throw new PackImportError(`Cannot read the pack: ${reason}`);
        }
        const total = Number(/\/(\d+)$/.exec(response.headers.get('Content-Range') ?? '')?.[1]);
        if (total !== this.zipSize) {
            await response.body?.cancel().catch(() => undefined);
            throw new PackImportError(
                'Cannot read the pack: it changed on the repository since its manifest was written - try again later.',
            );
        }
        return response;
    }

    /** A file too big to hold in memory: streamed to disk, inflated and checked on the way. */
    private async streamFile(file: PlannedFile): Promise<void> {
        const {entry} = file;
        const part = `${file.destination}.part`;
        mkdirSync(dirname(file.destination), {recursive: true});
        await this.retry(async () => {
            const before = this.downloaded;
            // No answer for a while = dead connection; a plain timeout would cut a slow, live one.
            const controller = new AbortController();
            let idle = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
            let size = 0;
            let checksum = 0;
            const meter = new Transform({
                transform: (chunk: Buffer, _encoding, callback) => {
                    clearTimeout(idle);
                    idle = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
                    this.advance(chunk.length);
                    callback(null, chunk);
                },
            });
            const check = new Transform({
                transform: (chunk: Buffer, _encoding, callback) => {
                    size += chunk.length;
                    checksum = crc32(chunk, checksum);
                    callback(null, chunk);
                },
            });
            try {
                const response = await this.request(entry.offset, entry.compressedSize, controller.signal);
                if (!response.body) {
                    throw new Error('empty answer');
                }
                const body = Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0]);
                await (entry.method === 8
                    ? pipeline(body, meter, createInflateRaw(), check, createWriteStream(part))
                    : pipeline(body, meter, check, createWriteStream(part)));
            } catch (error) {
                rmSync(part, {force: true});
                this.downloaded = before;
                throw error;
            } finally {
                clearTimeout(idle);
            }
            if (size !== entry.size || checksum !== entry.crc32) {
                rmSync(part, {force: true});
                // Not a network failure: asking again would bring the same bytes.
                throw new PackImportError(`${entry.name} does not match the pack manifest (pack re-published?).`);
            }
        });
        renameSync(part, file.destination);
    }

    private advance(bytes: number): void {
        this.downloaded += bytes;
        const now = Date.now();
        if (now - this.lastProgress >= PROGRESS_INTERVAL_MS) {
            this.lastProgress = now;
            this.reporter.progress('download', Math.min(this.downloaded, this.total), this.total);
        }
    }
}

/** Mirrors `parseInt(value, 10)`, with null instead of NaN: a year like "198?" is not written. */
function parseYear(value: string | null | undefined): number | null {
    const year = parseInt(value ?? '', 10);
    return Number.isNaN(year) ? null : year;
}

/**
 * One machine entry in mame's favorites.ini layout: 16 lines, the rom name on lines 1 and 8, its
 * description on line 2, and fixed filler/flags around them. mame has no command line option to
 * add a favorite - only its in-game menu writes the file - so its layout is reproduced here.
 */
function favoriteEntry(romName: string, fullname: string): string {
    return `${[romName, fullname, '', '', '', '0', '', romName, '', '', '', '1', '', '', '', '1'].join('\n')}\n`;
}

/**
 * Appends every game not already listed to mame's own favorites.ini, keeping whatever is there.
 * MAUI picks the new favorites up from that file. A mame still running rewrites favorites.ini
 * from its own memory when it exits and would drop these entries.
 */
export function addGamesToFavorites(favoritesPath: string, games: readonly StartingPackGameEntry[], summary: PackImportSummary): void {
    let text = existsSync(favoritesPath) ? readFileSync(favoritesPath, 'utf8') : `\ufeff${FAVORITES_HEADER}`;
    const newline = text.includes('\r\n') ? '\r\n' : '\n';
    const known = new Set(text.split(/\r\n|\r|\n/).map(line => line.trim()).filter(line => FAVORITE_ROM_NAME_REGEX.test(line)));

    let added = '';
    for (const game of games) {
        if (known.has(game.romName)) {
            continue;
        }
        known.add(game.romName);
        added += favoriteEntry(game.romName, game.fullname || game.romName);
        summary.favoritesAdded++;
    }
    if (!added) {
        return;
    }
    if (!text.endsWith('\n')) {
        text += newline;
    }
    mkdirSync(dirname(favoritesPath), {recursive: true});
    writeFileSync(favoritesPath, text + added.replaceAll('\n', newline), 'utf8');
}

/**
 * Adds the publisher/developer the pack carries to roms-infos-cache.json (FavoritesStore.ts's
 * RomsInfosCache), for the games it doesn't know yet: the ScreenScraper download then skips a
 * game that came with its artwork and these infos. An entry already there is kept, it may be
 * newer than the pack's. Older packs carry none: nothing added.
 */
export function addGamesToRomsInfos(
    cachePath: string, games: readonly StartingPackGameEntry[], generatedAt: string | undefined, summary: PackImportSummary,
): void {
    let cache: {updatedAt?: string; entries?: Record<string, unknown>} = {};
    if (existsSync(cachePath)) {
        try {
            cache = JSON.parse(readFileSync(cachePath, 'utf8'));
        } catch {
            summary.warnings.push('roms-infos-cache.json unreadable, publishers not recorded.');
            return;
        }
    }
    const entries = cache.entries ??= {};
    let added = 0;
    for (const game of games) {
        if (game.romName in entries || !ROM_INFOS_FIELDS.some(field => field in game)) {
            continue;
        }
        entries[game.romName] = {
            ...Object.fromEntries(ROM_INFOS_FIELDS.map(field => [field, game[field] ?? null])),
            fetchedAt: generatedAt ?? null,
        };
        added++;
    }
    if (!added) {
        return;
    }
    cache.updatedAt = new Date().toISOString();
    writeFileSync(cachePath, JSON.stringify(cache, null, 1));
    summary.romsInfosAdded += added;
}

const MAX_PROBLEMS_SHOWN = 3;

/**
 * The games the installed MAME cannot run with the sets just installed, each with the reason: a
 * pack is built from the romset of one MAME version, and a set can differ in another. Such a game
 * is left out of the database, the favorites and the publishers. A set MAME says nothing of is
 * kept: only a verdict rejects.
 */
async function findIncompatibleGames(
    games: readonly StartingPackGameEntry[], options: PackImportOptions, summary: PackImportSummary,
): Promise<Map<string, string>> {
    const rejected = new Map<string, string>();
    const romNames = games.filter(game => game.hasRomFile).map(game => game.romName);
    if (!options.verifyRoms || !romNames.length) {
        return rejected;
    }
    let verdicts: ReadonlyMap<string, RomVerdict> | null = null;
    try {
        verdicts = await options.verifyRoms(romNames);
    } catch {
        // Reported below, like a MAME that could not be run.
    }
    if (!verdicts) {
        summary.warnings.push('The installed MAME could not check the roms: games imported unchecked.');
        return rejected;
    }
    for (const romName of romNames) {
        const verdict = verdicts.get(romName);
        if (verdict?.status === 'unknown') {
            rejected.set(romName, 'it does not know this game');
        } else if (verdict?.status === 'bad') {
            const more = verdict.problems.length - MAX_PROBLEMS_SHOWN;
            rejected.set(romName, verdict.problems.slice(0, MAX_PROBLEMS_SHOWN).join('; ')
                + (more > 0 ? `; and ${more} more` : '') || 'bad romset');
        }
    }
    return rejected;
}

async function importGames(
    manifest: StartingPackManifest, results: ReadonlyMap<string, string | null>, options: PackImportOptions,
    summary: PackImportSummary,
): Promise<void> {
    const {store, reporter, targets} = options;
    // undefined: not in the pack. A file that failed to install fails what needs it.
    const installed = (name: string): boolean | undefined => {
        const result = results.get(name);
        if (typeof result === 'string') {
            throw new Error(`${name}: ${result}`);
        }
        return result === undefined ? undefined : true;
    };

    for (const biosName of manifest.biosRoms ?? []) {
        try {
            if (installed(`roms/${biosName}.zip`)) {
                summary.biosFilesWritten++;
            } else {
                summary.warnings.push(`BIOS "${biosName}": missing from the ZIP, skipped.`);
            }
        } catch (error) {
            summary.errors.push(`BIOS "${biosName}": ${(error as Error).message}`);
        }
    }

    const categoryIds = new Map<string, number>();
    const games = manifest.games;
    const incompatible = await findIncompatibleGames(games, options, summary);
    reporter.progress('import', 0, games.length);
    for (const [index, game] of games.entries()) {
        const romName = game.romName;
        if (incompatible.has(romName)) {
            // Its set goes too, when this import wrote it: left there, the pack would show the game as owned.
            if (targets.romPath && results.get(`roms/${romName}.zip`) === null) {
                rmSync(resolve(targets.romPath, `${romName}.zip`), {force: true});
            }
            summary.incompatibleGames.push(romName);
            reporter.line(`  ${romName}: not imported, the installed MAME cannot run it (${incompatible.get(romName)}).`);
            reporter.progress('import', index + 1, games.length);
            continue;
        }
        try {
            let categoryId: number | null = null;
            if (game.categoryName) {
                if (!categoryIds.has(game.categoryName)) {
                    const category = await store.findOrCreateCategory(game.categoryName);
                    categoryIds.set(game.categoryName, category.id);
                    if (category.created) {
                        summary.categoriesCreated.push(game.categoryName);
                    }
                }
                categoryId = categoryIds.get(game.categoryName) ?? null;
            }

            if (game.hasRomFile) {
                if (installed(`roms/${romName}.zip`)) {
                    summary.romFilesWritten++;
                } else {
                    summary.warnings.push(`${romName}: rom listed in the manifest but missing from the ZIP.`);
                }
            }
            if (game.hasMarquee && installed(`marquees/${romName}.png`)) {
                summary.marqueesWritten++;
            }
            if (game.hasFlyer && installed(`flyers/${romName}.png`)) {
                summary.flyersWritten++;
            }
            if (game.hasLogo && installed(`logos/${romName}.png`)) {
                summary.logosWritten++;
            }

            await store.upsertGame(romName, {
                id_category: categoryId,
                fullname: game.fullname ?? null,
                shortname: game.shortname ?? null,
                subname: game.subname ?? null,
                manufacturer: game.manufacturer ?? null,
                year: parseYear(game.year),
                hi: false,
                player_alt: game.player_alt ?? 0,
                player_sim: game.player_sim ?? 0,
            });
            summary.gamesUpserted++;
            reporter.line(`  ${romName}: ${game.fullname} imported.`);
        } catch (error) {
            // One game failing does not stop the others.
            const message = error instanceof Error && error.message ? error.message : 'unexpected error';
            summary.errors.push(`${romName}: ${message}`);
            reporter.line(`  ${romName}: error (${message}).`);
        }
        reporter.progress('import', index + 1, games.length);
    }

    const imported = games.filter(game => !incompatible.has(game.romName));
    addGamesToFavorites(targets.favoritesPath(), imported, summary);
    addGamesToRomsInfos(targets.romsInfosCachePath, imported, manifest.generatedAt, summary);
}

function reportSummary(summary: PackImportSummary, say: (text: string) => void): void {
    say([
        `${summary.gamesUpserted} game(s) imported`,
        `${summary.romFilesWritten} rom(s) written`,
        `${summary.biosFilesWritten} bios written`,
        `${summary.marqueesWritten} marquee(s)`,
        `${summary.flyersWritten} flyer(s)`,
        `${summary.logosWritten} logo(s)`,
        `${summary.favoritesAdded} favorite(s) added`,
        `${summary.romsInfosAdded} publisher(s) recorded`,
        `${summary.errors.length} error(s)`,
        ...(summary.incompatibleGames.length ? [`${summary.incompatibleGames.length} game(s) not compatible with the installed MAME`] : []),
    ].join(' — '));
    if (summary.categoriesCreated.length) {
        say(`Categories created: ${summary.categoriesCreated.join(', ')}`);
    }
    if (summary.directoriesImported.length) {
        say(`Folder(s) imported: ${summary.directoriesImported.map(dir => `${dir.zipFolder} (${dir.filesWritten})`).join(', ')}`);
    }
    summary.warnings.forEach(warning => say(`WARNING: ${warning}`));
    summary.errors.forEach(error => say(`ERROR: ${error}`));
}

/**
 * Imports a pack of the repository, or only some of its games. Resolves true when everything
 * went in, false after an error - each one reported as a line. `options.companion` must describe
 * the pack's files (describePack()).
 */
export async function importRepositoryPack(options: PackImportOptions): Promise<boolean> {
    const {reporter, targets, only} = options;
    const say = (text: string): void => reporter.line(`[import] ${text}`);
    try {
        const pack = describePack(options.companion);
        if (!pack) {
            throw new PackImportError('The repository does not say where the files of this pack are.');
        }
        say(`Pack: ${options.url} (${humanSize(pack.zipSize)}, read partially)`);
        const files = new Map(pack.files.map(file => [file.name, file]));
        const hasFolder = (folder: string): boolean => pack.files.some(file => file.name.startsWith(`${folder}/`));

        let manifest = pack.manifest;
        if (manifest) {
            const missing = [
                ['roms path (rompath - mame binary configured and valid?)', targets.romPath],
                ['marquees_directory (ui.ini)', targets.marqueePath],
                ['flyers_directory (ui.ini)', targets.flyerPath],
                ['logos_directory (ui.ini)', targets.logoPath],
                ['categorypath (ui.ini)', targets.categoryDir],
            ].filter(([, value]) => value === null).map(([label]) => label);
            if (missing.length) {
                throw new PackImportError(`Incomplete MAME configuration, import impossible - missing: ${missing.join(', ')}`);
            }
        } else if (only) {
            throw new PackImportError('Picking games needs a pack with a manifest.');
        } else if (!IMPORTABLE_MAME_DIRECTORIES.some(([folder]) => hasFolder(folder))
            && !IMPORTABLE_ROOT_FILES.some(name => files.has(name))) {
            const folders = IMPORTABLE_MAME_DIRECTORIES.map(([folder]) => folder).join(', ');
            throw new PackImportError(`Invalid pack: no manifest, and no recognized folder (${folders}) in the ZIP.`);
        }

        const summary = defaultSummary();
        let entryFilter: Set<string> | null = null;
        if (manifest && only) {
            manifest = selectGames(manifest, only, summary);
            entryFilter = wantedEntries(manifest);
        }

        const plan: PlannedFile[] = [];
        const planFile = (entry: StartingPackFileEntry, root: string, relative: string): void => {
            const destination = destinationUnder(root, relative);
            if (destination) {
                plan.push({entry, root, destination});
            }
        };

        // The mame folders of the ZIP, each kept with its own subdirectories.
        const directories: {folder: string; root: string; names: string[]}[] = [];
        for (const [folder, iniKey] of IMPORTABLE_MAME_DIRECTORIES) {
            if (!hasFolder(folder)) {
                continue;
            }
            const root = targets.directoryFor(iniKey);
            if (!root) {
                summary.warnings.push(`${folder}/: "${iniKey}" not found in the mame configuration, skipped.`);
                continue;
            }
            const inFolder = pack.files.filter(file => file.name.startsWith(`${folder}/`)
                && (!entryFilter || !PER_GAME_FOLDERS.includes(folder) || entryFilter.has(file.name)));
            inFolder.forEach(file => planFile(file, root, file.name.slice(folder.length + 1)));
            directories.push({folder, root, names: inFolder.map(file => file.name)});
        }
        const rootFiles = IMPORTABLE_ROOT_FILES.filter(name => files.has(name));
        rootFiles.forEach(name => planFile(files.get(name) as StartingPackFileEntry, targets.iniPath, name));
        if (manifest) {
            // Per-game files, flattened to their basename in the folder of their kind.
            const roots: Record<string, string | null> = {
                roms: targets.romPath, marquees: targets.marqueePath, flyers: targets.flyerPath, logos: targets.logoPath,
            };
            for (const name of wantedEntries(manifest)) {
                const entry = files.get(name);
                const root = roots[name.slice(0, name.indexOf('/'))];
                if (entry && root) {
                    planFile(entry, root, name.slice(name.lastIndexOf('/') + 1));
                }
            }
        }

        checkDiskSpace(plan);

        if (manifest) {
            say(`${manifest.games.length} game(s) ${only ? 'selected in' : 'in'} the manifest `
                + `(generated on ${manifest.generatedAt ?? '?'}), ${(manifest.biosRoms ?? []).length} bios.`);
        }
        if (directories.length) {
            say(`mame folder(s) detected in the ZIP: ${directories.map(directory => directory.folder).join(', ')}.`);
        }

        const results = await new PackDownloader(
            options.url, options.headers, pack.zipSize, plan, reporter, options.fetchImpl ?? fetch,
        ).run();

        const written = (names: readonly string[], label: (name: string) => string): number => {
            let count = 0;
            for (const name of names) {
                const result = results.get(name);
                if (result === null) {
                    count++;
                } else if (typeof result === 'string') {
                    summary.errors.push(`${label(name)}: ${result}`);
                }
            }
            return count;
        };
        for (const directory of directories) {
            const filesWritten = written(directory.names, name => name);
            summary.directoriesImported.push({zipFolder: directory.folder, filesWritten});
            reporter.line(`  ${directory.folder}/: ${filesWritten} file(s) copied to ${directory.root}.`);
        }
        for (const name of rootFiles) {
            if (written([name], () => name)) {
                summary.directoriesImported.push({zipFolder: name, filesWritten: 1});
                reporter.line(`  ${name}: copied to ${targets.iniPath}.`);
            }
        }
        if (manifest) {
            await importGames(manifest, results, options, summary);
        }

        reportSummary(summary, say);
        return summary.errors.length === 0;
    } catch (error) {
        if (!(error instanceof PackImportError)) {
            throw error;
        }
        say(error.message);
        return false;
    }
}
