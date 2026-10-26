import {existsSync, mkdirSync, readFileSync, writeFileSync} from 'fs';
import {homedir} from 'os';
import {dirname, join} from 'path';
import {MameHiExtractor} from '@arcadoolic/mhiex';
import {hasHiscoreExtraction, isNameless, scorePseudo3} from '@/class/HiscoreSupport';
import type {ApiFailure, MauiApiClient, RecoveryNotFoundReason} from '@/class/MauiApiClient';
import type {ScoreStore} from '@/class/ScoreOutbox';
import type {TableRow} from '@/class/ScoreDiff';

// Scores this cabinet's files hold but MAUI-API never got, asked for by an administrator after
// checking them (maui-api D93). Each open request is looked for in the game's table, read with
// the current extractor: found, the score goes to the outbox like any other, its id being the
// request's (a second look before it is sent queues nothing twice); not found, MAUI-API is told
// why, with the table read. The answers are kept for the BO's Online card.

export type TableReading = {rows: TableRow[]} | {reason: Exclude<RecoveryNotFoundReason, 'not_in_table' | 'player_not_on_cabinet'>};

export interface RecoveryDeps {
    // The cabinet's players: a request names one by its MAUI-API id.
    players: () => Promise<{pseudo_3: string; remote_id: string | null}[]>;
    readTable: (romname: string, table: string) => Promise<TableReading>;
    store: Pick<ScoreStore, 'add'>;
    record?: (answer: RecoveryAnswer) => void;
}

export interface RecoveryAnswer {
    id: string;
    romname: string;
    score: number;
    pseudo3: string | null;
    outcome: 'queued' | 'not_found';
    reason?: RecoveryNotFoundReason;
    answeredAt: string;
}

export interface RecoverySummary {
    queued: number;
    notFound: number;
    failure: ApiFailure | null;
}

/** Answers the open requests of this cabinet. Never throws: a failure is retried at the next turn. */
export async function answerScoreRecoveries(client: MauiApiClient, deps: RecoveryDeps): Promise<RecoverySummary> {
    const summary: RecoverySummary = {queued: 0, notFound: 0, failure: null};
    const listed = await client.listScoreRecoveries();
    if (listed.kind !== 'ok') {
        return {...summary, failure: listed};
    }
    if (listed.value.length === 0) {
        return summary;
    }
    const players = new Map((await deps.players())
        .filter(player => player.remote_id !== null)
        .map(player => [player.remote_id as string, player.pseudo_3]));
    for (const request of listed.value) {
        const pseudo3 = players.get(request.playerId) ?? null;
        const answer = (outcome: RecoveryAnswer['outcome'], reason?: RecoveryNotFoundReason) => deps.record?.({
            id: request.id, romname: request.romname, score: request.score, pseudo3, outcome,
            ...(reason ? {reason} : {}), answeredAt: new Date().toISOString(),
        });
        const notFound = async (reason: RecoveryNotFoundReason, rows: TableRow[]) => {
            const reported = await client.reportScoreRecovery(request.id, reason, rows);
            if (reported.kind === 'ok') {
                summary.notFound++;
                answer('not_found', reason);
            } else {
                summary.failure = reported;
            }
        };

        if (pseudo3 === null) {
            await notFound('player_not_on_cabinet', []);
            continue;
        }
        const reading = await deps.readTable(request.romname, request.table);
        if ('reason' in reading) {
            await notFound(reading.reason, []);
            continue;
        }
        const row = findRow(reading.rows, pseudo3, request.score);
        if (!row) {
            await notFound('not_in_table', reading.rows);
            continue;
        }
        await deps.store.add([{
            id: request.id, recoveryId: request.id, playerId: request.playerId, romname: request.romname,
            table: request.table, score: request.score, rankOnCabinet: row.rank,
            achievedAt: request.achievedAt, startupId: null, attribution: 'recovered',
        }]);
        summary.queued++;
        answer('queued');
    }
    return summary;
}

/** A table of the game as its current extractor reads it: `default`, or one of its extras. */
export async function readRecoveryTable(mameHome: string, romname: string, table: string): Promise<TableReading> {
    if (!hasHiscoreExtraction(romname)) {
        return {reason: 'unsupported'};
    }
    try {
        const read = await new MameHiExtractor(mameHome).get(romname);
        if (!read) {
            return {reason: 'unsupported'};
        }
        const scores = read.extract(true).scores;
        const rows = table === 'default' ? scores.default : (scores.extras as Record<string, TableRow[]> | undefined)?.[table];
        return rows ? {rows} : {reason: 'unreadable'};
    } catch (error) {
        return {reason: (error as NodeJS.ErrnoException).code === 'ENOENT' ? 'no_file' : 'unreadable'};
    }
}

/**
 * The row with exactly this score and these initials, or no name at all: a game that writes none
 * (1942) cannot tell whose it is, the administrator who asked for it checked.
 */
export function findRow(rows: TableRow[], pseudo3: string, score: number): TableRow | null {
    return rows.find(row => Number(row.score) === score && (scorePseudo3(row.name) === pseudo3 || isNameless(row.name))) ?? null;
}

const KEEP = 50;

export function getRecoveryHistoryPath(): string {
    return join(homedir(), '.mame-awesome-ui', 'score-recoveries.json');
}

export function readRecoveryAnswers(path = getRecoveryHistoryPath()): RecoveryAnswer[] {
    try {
        const list = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : [];
        return Array.isArray(list) ? list : [];
    } catch {
        return [];
    }
}

/** Newest first, one line per request, the latest KEEP only. Never throws. */
export function recordRecoveryAnswer(answer: RecoveryAnswer, path = getRecoveryHistoryPath()): void {
    try {
        mkdirSync(dirname(path), {recursive: true});
        const others = readRecoveryAnswers(path).filter(previous => previous.id !== answer.id);
        writeFileSync(path, JSON.stringify([answer, ...others].slice(0, KEEP), null, 2));
    } catch (error) {
        console.warn('[ScoreRecovery] Answer not recorded:', error);
    }
}
