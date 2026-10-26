import {existsSync, mkdirSync, readFileSync, writeFileSync} from 'fs';
import {homedir} from 'os';
import {dirname, join} from 'path';

// The diagnostics this cabinet sent to MAUI-API (maui-api D92), shown on the BO's page of each
// game: its owner knows what left the cabinet, and when.

export interface SentDiagnostic {
    romName: string;
    id: string;
    sentAt: string;
    files: number;
    size: number;
    logs: boolean;
}

const KEEP = 50;

export function getDiagnosticHistoryPath(): string {
    return join(homedir(), '.mame-awesome-ui', 'diagnostics-sent.json');
}

export function readSentDiagnostics(path = getDiagnosticHistoryPath()): SentDiagnostic[] {
    try {
        const list = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : [];
        return Array.isArray(list) ? list : [];
    } catch {
        return [];
    }
}

/** Newest first, the latest KEEP only. Never throws: the diagnostic was sent all the same. */
export function recordSentDiagnostic(sent: SentDiagnostic, path = getDiagnosticHistoryPath()): void {
    try {
        mkdirSync(dirname(path), {recursive: true});
        writeFileSync(path, JSON.stringify([sent, ...readSentDiagnostics(path)].slice(0, KEEP), null, 2));
    } catch (error) {
        console.warn('[DiagnosticHistory] Sent diagnostic not recorded:', error);
    }
}
