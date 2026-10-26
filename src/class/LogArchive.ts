import {createReadStream, createWriteStream, existsSync, readdirSync, renameSync, statSync, unlinkSync} from 'fs';
import {basename, join} from 'path';
import {pipeline} from 'stream/promises';
import {createGzip} from 'zlib';

// The archives of MAUI's log, next to it in its directory: maui-20261026-081343.log.gz, one per
// rotation (electron-log calls archive() once the log passes its maxSize). Electron-free, so the
// unit tests run it on a plain directory.

export const LOG_FILE_NAME = 'maui.log';

const ARCHIVE = /^maui-(\d{8}-\d{6})(?:-\d+)?\.log(\.gz)?$/;
const KEEP_DAYS = 30;
const KEEP_COUNT = 20;
const DAY_MS = 24 * 60 * 60 * 1000;

/** 20261026-081343, local time: what a cabinet's owner reads next to their own clock. */
export function archiveStamp(date: Date): string {
    const pad = (value: number) => String(value).padStart(2, '0');
    return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`
        + `-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

/** A name no archive has yet: two rotations within the same second get -1, -2... */
function freeArchiveName(dir: string, stamp: string): string {
    for (let n = 0; ; n++) {
        const name = `maui-${stamp}${n ? `-${n}` : ''}.log`;
        if (!existsSync(join(dir, name)) && !existsSync(join(dir, `${name}.gz`))) {
            return name;
        }
    }
}

/** When an archive was cut, read from its name: compressing it changes its modification time. */
function archiveDate(name: string): Date | null {
    const stamp = ARCHIVE.exec(name)?.[1];
    if (!stamp) {
        return null;
    }
    const [y, mo, d, h, mi, s] = [0, 4, 6, 9, 11, 13].map((start, i) => Number(stamp.slice(start, i ? start + 2 : 4)));
    return new Date(y, mo - 1, d, h, mi, s);
}

/**
 * The archives to delete among the file names of the directory: those older than KEEP_DAYS, then
 * the oldest past KEEP_COUNT. Anything else is left alone.
 */
export function archivesToPrune(names: string[], now: Date): string[] {
    const archives = names.map(name => ({name, date: archiveDate(name)}))
        .filter((archive): archive is {name: string; date: Date} => archive.date !== null)
        .sort((a, b) => b.date.getTime() - a.date.getTime() || b.name.localeCompare(a.name));
    return archives.filter((archive, index) => index >= KEEP_COUNT || now.getTime() - archive.date.getTime() > KEEP_DAYS * DAY_MS)
        .map(archive => archive.name);
}

async function compress(path: string): Promise<void> {
    await pipeline(createReadStream(path), createGzip(), createWriteStream(`${path}.gz`));
    unlinkSync(path);
}

function prune(dir: string, now: Date): void {
    for (const name of archivesToPrune(readdirSync(dir), now)) {
        unlinkSync(join(dir, name));
    }
}

// One tidying at a time: a rotation can come while the previous one is still compressing.
let tidying: Promise<void> = Promise.resolve();

/**
 * Compresses the archives not compressed yet (a rotation cut short by the application quitting,
 * or the logs moved in by adoptLegacyLogs()), then prunes. Never throws: a log that cannot be
 * archived must not stop anything.
 */
export function tidyArchives(dir: string, now = new Date()): Promise<void> {
    tidying = tidying.then(async () => {
        try {
            for (const name of readdirSync(dir).filter(name => ARCHIVE.test(name) && !name.endsWith('.gz'))) {
                await compress(join(dir, name));
            }
            prune(dir, now);
        } catch (err) {
            process.stderr.write(`Log archives not tidied: ${err instanceof Error ? err.message : String(err)}\n`);
        }
    });
    return tidying;
}

/**
 * The rotation: electron-log calls this, synchronously, with the log that grew past its maxSize,
 * and starts a new one right after. The file is only renamed here; it is compressed afterwards.
 */
export function archive(logPath: string, now = new Date()): void {
    const dir = join(logPath, '..');
    renameSync(logPath, join(dir, freeArchiveName(dir, archiveStamp(now))));
    void tidyArchives(dir, now);
}

/**
 * Moves the logs of MAUI versions before electron-log 5 (log.log and log.old.log, in the user data
 * directory, or in the log directory on macOS) into the archives, dated by their last write, so
 * that they stay readable and go away with the others.
 */
export function adoptLegacyLogs(legacyPaths: string[], dir: string): void {
    for (const path of new Set(legacyPaths)) {
        try {
            if (!existsSync(path) || basename(path) === LOG_FILE_NAME) {
                continue;
            }
            renameSync(path, join(dir, freeArchiveName(dir, archiveStamp(statSync(path).mtime))));
        } catch (err) {
            process.stderr.write(`Legacy log not moved: ${err instanceof Error ? err.message : String(err)}\n`);
        }
    }
}
