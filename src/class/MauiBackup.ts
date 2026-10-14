import {chmodSync, existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync} from 'fs';
import {basename, join} from 'path';
// Pinned (see package.json) to the last 0.5.x release: 0.5.17+/0.6.x ship optional-chaining
// syntax in methods/inflater.js that the main process's webpack build (older acorn parser)
// fails to parse. Bumping this past 0.5.16 breaks `just serve`/`just build` with a
// "Module parse failed: Unexpected token" error on that file - re-check before upgrading.
import AdmZip from 'adm-zip';

// What the BO's MAUI tab exports and imports (/maui/export, /maui/import): every file the
// application keeps in its own directory (~/.mame-awesome-ui), by part. Not the roms nor
// mame's own data (~/.mame).

export type BackupPartId = 'config' | 'database' | 'caches' | 'online';

export interface BackupPart {
    id: BackupPartId;
    label: string;
    // Files at the root of the directory, at the root of the ZIP too.
    files: string[];
    // Directories whose files (not sub-directories) are taken, under their own name in the ZIP.
    directories: string[];
}

// Held owner-only by the application (Config.class.ts, OnlineSettings.ts): restored the same way.
const PRIVATE_FILES = new Set(['mame-awesome-ui-config.json', 'online.json']);
const PRIVATE_MODE = 0o600;

export const BACKUP_PARTS: readonly BackupPart[] = [
    {
        id: 'config',
        label: 'the configuration',
        files: ['mame-awesome-ui-config.json', 'removed-favorites.json'],
        directories: [],
    },
    {
        // The avatars go with the players they belong to, in the database.
        id: 'database',
        label: 'the database',
        files: ['mame-awesome-ui.sqlite', 'avatar-sync.json'],
        directories: ['avatars', 'online-avatars'],
    },
    {
        id: 'caches',
        label: 'the ScreenScraper caches',
        files: ['favorites-cache.json', 'roms-infos-cache.json'],
        directories: [],
    },
    {
        // ONLINE's URL, key and token, and half of the machine's fingerprint (OnlineSettings.ts):
        // only to be restored on the same machine, never copied to another cabinet.
        id: 'online',
        label: 'the ONLINE session',
        files: ['online.json'],
        directories: [],
    },
];

export function parseBackupParts(ids: readonly string[]): BackupPartId[] {
    return BACKUP_PARTS.filter(part => ids.includes(part.id)).map(part => part.id);
}

function isPlainFile(path: string): boolean {
    return existsSync(path) && statSync(path).isFile();
}

/** The ZIP of the parts asked for, null when none of their files exists yet. */
export function buildBackup(dataDir: string, partIds: readonly BackupPartId[]): Buffer | null {
    const zip = new AdmZip();
    let count = 0;
    for (const part of BACKUP_PARTS.filter(candidate => partIds.includes(candidate.id))) {
        for (const file of part.files) {
            if (isPlainFile(join(dataDir, file))) {
                zip.addLocalFile(join(dataDir, file));
                count++;
            }
        }
        for (const directory of part.directories) {
            const path = join(dataDir, directory);
            if (!existsSync(path)) {
                continue;
            }
            for (const name of readdirSync(path)) {
                if (isPlainFile(join(path, name))) {
                    zip.addLocalFile(join(path, name), directory);
                    count++;
                }
            }
        }
    }
    return count === 0 ? null : zip.toBuffer();
}

interface Destination {
    part: BackupPart;
    file: string;
    directory: string | null;
}

// Only the names above are written, whatever else the ZIP holds: an entry never chooses where
// it lands. A root file is also found in a sub-folder of the ZIP (one zipped by hand, or by an
// older MAUI); a directory's file only under that directory's name.
function destinationOf(entryName: string): Destination | null {
    const parts = entryName.split(/[\\/]/).filter(part => part !== '');
    const name = parts[parts.length - 1] ?? '';
    if (name === '' || name === '.' || name === '..') {
        return null;
    }
    for (const part of BACKUP_PARTS) {
        if (part.files.includes(name)) {
            return {part, file: name, directory: null};
        }
        const directory = parts[parts.length - 2];
        if (directory !== undefined && part.directories.includes(directory)) {
            return {part, file: name, directory};
        }
    }
    return null;
}

const SQLITE_HEADER = 'SQLite format 3\0';

/** The same sanity checks as a lone .json or .sqlite import: a file the application would fail to read is refused. */
export function checkContent(destination: {file: string; directory: string | null}, data: Buffer): void {
    if (destination.directory !== null) {
        return;
    }
    if (destination.file.endsWith('.sqlite') && data.subarray(0, 16).toString('utf8') !== SQLITE_HEADER) {
        throw new Error(`${destination.file} does not look like a valid sqlite database.`);
    }
    if (destination.file.endsWith('.json')) {
        try {
            JSON.parse(data.toString('utf8'));
        } catch {
            throw new Error(`${destination.file} is not valid JSON.`);
        }
    }
}

/**
 * Writes what the ZIP holds of the parts back into the directory, and says which parts were
 * restored (empty: nothing the application knows of). A directory found in the ZIP is replaced
 * as a whole, so that it holds what it held when exported.
 */
export function restoreBackup(dataDir: string, zipData: Buffer): BackupPart[] {
    const destinations = new AdmZip(zipData).getEntries()
        .filter(entry => !entry.isDirectory)
        .map(entry => ({entry, destination: destinationOf(entry.entryName)}))
        .filter((item): item is {entry: AdmZip.IZipEntry; destination: Destination} => item.destination !== null);

    // Checked before anything is written: a damaged file never leaves half a restore behind.
    for (const {entry, destination} of destinations) {
        checkContent(destination, entry.getData());
    }

    const directories = new Set(destinations.map(item => item.destination.directory).filter(name => name !== null));
    for (const directory of directories) {
        rmSync(join(dataDir, directory), {recursive: true, force: true});
        mkdirSync(join(dataDir, directory), {recursive: true});
    }
    for (const {entry, destination} of destinations) {
        const path = destination.directory === null
            ? join(dataDir, destination.file)
            : join(dataDir, destination.directory, basename(destination.file));
        if (PRIVATE_FILES.has(destination.file) && destination.directory === null) {
            writeFileSync(path, entry.getData(), {mode: PRIVATE_MODE});
            chmodSync(path, PRIVATE_MODE);
        } else {
            writeFileSync(path, entry.getData());
        }
    }
    const restored = new Set(destinations.map(item => item.destination.part.id));
    return BACKUP_PARTS.filter(part => restored.has(part.id));
}

/**
 * Deletes the files of the parts given (the BO's Danger zone, MAUI tab): the same files the
 * export takes, so that nothing of a part is left behind. Says which parts had something.
 */
export function deleteBackupParts(dataDir: string, partIds: readonly BackupPartId[]): BackupPart[] {
    const deleted: BackupPart[] = [];
    for (const part of BACKUP_PARTS.filter(candidate => partIds.includes(candidate.id))) {
        const paths = [...part.files, ...part.directories].map(name => join(dataDir, name)).filter(path => existsSync(path));
        paths.forEach(path => rmSync(path, {recursive: true, force: true}));
        if (paths.length) {
            deleted.push(part);
        }
    }
    return deleted;
}
