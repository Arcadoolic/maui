import {existsSync, readFileSync, writeFileSync} from 'fs';
import {dirname, join} from 'path';
import {CONF_PACK_FILENAME, confPackVersion, getMissingConfPackFiles} from '@/class/ConfPack';
import {getFavoritesCachePath} from '@/class/FavoritesStore';
import {ensureFirstDirectory, getMameLocations} from '@/class/MameLocations';
import {importRepositoryPack, type PackGameStore, type PackImportTargets} from '@/class/PackImport';
import type {RepositoryAccess} from '@/class/RepositoryAuth';

/**
 * Keeps the configuration pack (ConfPack.ts) up to date by itself: the cabinet installs the
 * repository's one again when it changed (its companion's zip size and date, confPackVersion())
 * or when its files are missing, without anyone opening the BO. Run once per start of the ONLINE
 * session (OnlineSession's `updateConfPack`), before the first game: a corrected hiscore.dat
 * reaches every cabinet as soon as it is published, with the mhiex extractor that needs it.
 *
 * Light on purpose: lives outside boServer.ts (the BO's chunk is only loaded on demand), and only
 * writes what a pack without games holds, folders/ in categorypath and hiscore.dat in the mame home.
 */

/** Where the version installed last is kept, beside the favorites cache (the BO reads it too). */
export function getInstalledConfPackPath(): string {
    return join(dirname(getFavoritesCachePath()), 'conf-pack.json');
}

export function readInstalledConfPackVersion(path: string = getInstalledConfPackPath()): string | null {
    try {
        const {version} = JSON.parse(readFileSync(path, 'utf8')) as {version?: unknown};
        return typeof version === 'string' ? version : null;
    } catch {
        return null;
    }
}

export function writeInstalledConfPackVersion(version: string, path: string = getInstalledConfPackPath()): void {
    writeFileSync(path, JSON.stringify({version}));
}

/** Where a pack without games writes: categorypath for folders/, the mame home for its root files. */
export function confPackTargets(mameHome: string): PackImportTargets {
    const {uiIni, categoryDir} = getMameLocations(mameHome);
    return {
        iniPath: mameHome,
        romPath: null,
        marqueePath: null,
        flyerPath: null,
        logoPath: null,
        categoryDir,
        // Only written for the games of a pack: none here.
        romsInfosCachePath: '',
        directoryFor: iniKey => ensureFirstDirectory(uiIni[iniKey], mameHome),
        favoritesPath: () => {
            throw new Error('The configuration pack has no games.');
        },
    };
}

// The configuration pack has no games: nothing is ever saved through it.
const noGames: PackGameStore = {
    findOrCreateCategory: () => Promise.reject(new Error('The configuration pack has no games.')),
    upsertGame: () => Promise.reject(new Error('The configuration pack has no games.')),
};

export type ConfPackUpdateResult =
    | {kind: 'up_to_date'; version: string}
    | {kind: 'installed'; version: string | null}
    | {kind: 'skipped'; reason: string}
    | {kind: 'failed'; reason: string};

export interface ConfPackUpdateDeps {
    repository: () => Promise<RepositoryAccess>;
    mameHome: string;
    log: (message: string) => void;
    installedPath?: string;
    fetchImpl?: typeof fetch;
}

async function fetchCompanion(
    url: string, headers: Record<string, string>, fetchImpl: typeof fetch,
): Promise<unknown> {
    const response = await fetchImpl(`${url}/${CONF_PACK_FILENAME.replace(/\.zip$/, '')}.manifest.json`, {
        headers,
        // The headers carry the cabinet token: never follow a redirect elsewhere.
        redirect: 'error',
        signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
    }
    return response.json();
}

/** Installs the repository's configuration pack when it changed. Never throws. */
export async function updateConfPack(deps: ConfPackUpdateDeps): Promise<ConfPackUpdateResult> {
    const fetchImpl = deps.fetchImpl ?? fetch;
    const installedPath = deps.installedPath ?? getInstalledConfPackPath();
    try {
        if (!existsSync(join(deps.mameHome, 'ui.ini'))) {
            return {kind: 'skipped', reason: 'MAME is not configured yet'};
        }
        const repository = await deps.repository();
        if (!repository.ok) {
            return {kind: 'skipped', reason: `no repository (${repository.reason})`};
        }
        const companion = await fetchCompanion(repository.url, repository.headers, fetchImpl);
        const version = confPackVersion(companion);
        // hiscore.dat too: a mame home replaced by another one keeps conf-pack.json's version.
        const filesInPlace = !getMissingConfPackFiles(getMameLocations(deps.mameHome)).length
            && existsSync(join(deps.mameHome, 'hiscore.dat'));
        if (version && version === readInstalledConfPackVersion(installedPath) && filesInPlace) {
            return {kind: 'up_to_date', version};
        }
        const ok = await importRepositoryPack({
            url: `${repository.url}/${CONF_PACK_FILENAME}`,
            headers: repository.headers,
            companion,
            targets: confPackTargets(deps.mameHome),
            store: noGames,
            reporter: {line: line => deps.log(`[conf-pack] ${line}`), progress: () => undefined},
            fetchImpl,
        });
        if (!ok) {
            return {kind: 'failed', reason: 'the import did not go through'};
        }
        if (version) {
            writeInstalledConfPackVersion(version, installedPath);
        }
        return {kind: 'installed', version};
    } catch (error) {
        return {kind: 'failed', reason: error instanceof Error ? error.message : String(error)};
    }
}
