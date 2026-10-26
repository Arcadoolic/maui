import {existsSync, readdirSync, readFileSync, statSync} from 'fs';
import {join} from 'path';
import {gunzipSync, gzipSync} from 'zlib';
import {listSessionReports} from '@/class/CaptureDaemon';
import {LOG_FILE_NAME} from '@/class/LogArchive';
import type {HiscoreReport} from '@/class/HiscoreInspector';

// What a cabinet sends about a game when a player says a score is missing (maui-api D92): the
// files MAME wrote for it, its latest session reports, MAUI's logs if the owner agreed, and what
// MAUI makes of them. Sent to MAUI-API (MauiApiClient.sendDiagnostic()) or saved as a zip
// (DiagnosticZip.ts) by the BO's page of the game. Electron-free.

export type DiagnosticArea = 'hiscore' | 'nvram' | 'logs' | 'sessions';

export interface DiagnosticFile {
    area: DiagnosticArea;
    // A plain file name, no path (MAUI-API refuses anything else).
    name: string;
    modified: Date | null;
    content: Buffer;
}

export interface OmittedFile {
    area: DiagnosticArea;
    name: string;
    size: number;
    reason: 'bad_name' | 'too_many_files' | 'too_large';
}

export interface DiagnosticBundle {
    romName: string;
    comment: string | null;
    report: Record<string, unknown>;
    files: DiagnosticFile[];
}

export interface DiagnosticSources {
    romName: string;
    comment: string;
    // HiscoreInspector's look at the game: its files and its decoded tables.
    inspection: HiscoreReport;
    versions: {maui: string; mhiex: string; mame: string};
    // null: the owner did not attach the logs.
    logDir: string | null;
    capturesRoot?: string;
    now?: Date;
}

// MAUI-API's limits (maui-api D92).
export const MAX_FILES = 16;
export const MAX_SIZE = 1024 * 1024;

const SESSION_REPORTS = 5;
const LOG_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;
const ARCHIVE = /^maui-\d{8}-\d{6}(?:-\d+)?\.log\.gz$/;
// What MAUI-API takes as a file name.
const FILE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

// The whole games table dumped by Sequelize: no use to a diagnostic (MAUI before 2.19).
const SQL_LINE = /\] \[info\] Executing \(default\): /;
// A value after a word that names a secret: password=..., "token": "...", Bearer ...
const SECRET = /((?:password|passwd|pwd|token|secret|psk|api[_-]?key)["']?\s*[:=]\s*["']?)[^\s"',;}]+/gi;
const BEARER = /(Bearer\s+)\S+/gi;

// The start of a log entry; the lines of an entry printed over several lines don't have it.
const ENTRY = /^\[\d{4}-\d{2}-\d{2} /;

/** A log without the SQL entries (all their lines), its secrets masked. */
export function filterLog(text: string): string {
    let inSql = false;
    return text.split('\n')
        .filter((line) => {
            if (ENTRY.test(line)) {
                inSql = SQL_LINE.test(line);
            }
            return !inSql;
        })
        .map(line => line.replace(SECRET, '$1***').replace(BEARER, '$1***'))
        .join('\n');
}

/** The current log and the archives of the last LOG_DAYS days, newest first, filtered. */
function logFiles(logDir: string, now: Date): DiagnosticFile[] {
    if (!existsSync(logDir)) {
        return [];
    }
    const files: DiagnosticFile[] = [];
    const current = join(logDir, LOG_FILE_NAME);
    if (existsSync(current)) {
        files.push({area: 'logs', name: LOG_FILE_NAME, modified: statSync(current).mtime, content: Buffer.from(filterLog(readFileSync(current, 'utf8')))});
    }
    const archives = readdirSync(logDir)
        .filter(name => ARCHIVE.test(name))
        .map(name => ({name, modified: statSync(join(logDir, name)).mtime}))
        .filter(archive => now.getTime() - archive.modified.getTime() <= LOG_DAYS * DAY_MS)
        .sort((a, b) => b.name.localeCompare(a.name));
    for (const archive of archives) {
        try {
            const text = gunzipSync(readFileSync(join(logDir, archive.name))).toString('utf8');
            files.push({area: 'logs', name: archive.name, modified: archive.modified, content: gzipSync(filterLog(text))});
        } catch {
            // A damaged archive: the others are still worth sending.
        }
    }
    return files;
}

function sessionFiles(romName: string, capturesRoot: string | undefined): DiagnosticFile[] {
    return listSessionReports(romName, capturesRoot).slice(0, SESSION_REPORTS).map(report => ({
        area: 'sessions' as const,
        name: `${report.name}.json`,
        modified: report.modified,
        content: readFileSync(report.path),
    }));
}

function gameFiles(inspection: HiscoreReport): DiagnosticFile[] {
    return inspection.files.map(file => ({
        area: file.name.startsWith('hiscore/') ? 'hiscore' as const : 'nvram' as const,
        name: file.name.slice(file.name.lastIndexOf('/') + 1),
        modified: file.modified,
        content: readFileSync(file.path),
    }));
}

/**
 * Everything to send, within MAUI-API's limits: the game's own files first, then its session
 * reports, then the logs, newest first. What does not fit is left out and listed in the report.
 */
export function buildDiagnosticBundle(sources: DiagnosticSources): DiagnosticBundle {
    const now = sources.now ?? new Date();
    const candidates = [
        ...gameFiles(sources.inspection),
        ...sessionFiles(sources.romName, sources.capturesRoot),
        ...(sources.logDir ? logFiles(sources.logDir, now) : []),
    ];
    const files: DiagnosticFile[] = [];
    const omitted: OmittedFile[] = [];
    let size = 0;
    for (const file of candidates) {
        const reason = !FILE_NAME.test(file.name) ? 'bad_name'
            : files.length >= MAX_FILES ? 'too_many_files'
                : size + file.content.length > MAX_SIZE ? 'too_large' : null;
        if (reason) {
            omitted.push({area: file.area, name: file.name, size: file.content.length, reason});
            continue;
        }
        files.push(file);
        size += file.content.length;
    }
    const {inspection} = sources;
    return {
        romName: sources.romName,
        comment: sources.comment.trim() || null,
        report: {
            versions: sources.versions,
            platform: process.platform,
            sources: inspection.sources,
            state: inspection.state,
            ...(inspection.error ? {error: inspection.error} : {}),
            tables: inspection.tables.map(table => ({
                id: table.id,
                rows: table.rows.map(row => ({rank: row.rank, score: row.score, name: row.name, status: row.status})),
            })),
            expectedSizes: Object.fromEntries(inspection.files.filter(file => file.expectedSize !== null).map(file => [file.name, file.expectedSize])),
            logs: sources.logDir !== null,
            omitted,
        },
        files,
    };
}
