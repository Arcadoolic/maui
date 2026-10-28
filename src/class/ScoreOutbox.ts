import {randomUUID} from 'crypto';
import type {ApiFailure, MauiApiClient, ScoreResult, ScoreSubmission} from '@/class/MauiApiClient';
import {scorePseudo3} from '@/class/HiscoreSupport';
import type {TableRow} from '@/class/ScoreDiff';
import type {GameIntegrityReport} from '@/class/GameIntegrity';

// Scores waiting for MAUI-API (maui-api D50, Lot 2.3). A score is queued once found (PlaySession),
// with its own UUID, and leaves the outbox once MAUI-API answered for it, whatever the answer:
// accepted, not_improved or rejected. A failed batch waits, longer after each failure, and is sent
// again with the same UUIDs: MAUI-API stores it only once. Only MAUI-API knows a player's best,
// hidden scores aside: every score is sent, and MAUI-API answers not_improved to what does not
// beat it. A best cached here would stay above a score hidden since (BNJ on 1941, 2026-10-28).

export const SCORE_BATCH_SIZE = 100;

const BACKOFF_BASE_MS = 60_000;
const BACKOFF_MAX_MS = 3_600_000;

export interface OutboxEntry {
    submission: ScoreSubmission;
    attempts: number;
}

/** Where the outbox lives: SQLite in the app (SqliteScoreStore.ts). */
export interface ScoreStore {
    add(submissions: ScoreSubmission[]): Promise<void>;
    // Due at `now`, oldest first.
    due(now: Date, limit: number): Promise<OutboxEntry[]>;
    remove(ids: string[]): Promise<void>;
    reschedule(ids: string[], attempts: number, nextAttemptAt: Date): Promise<void>;
}

export interface PublishablePlayer {
    pseudo_3: string;
    active: boolean;
    remote_id: string | null;
    is_public: boolean;
    online_status: string | null;
}

/** A player whose scores go to the shared leaderboards: active, public, linked, not disabled. */
export function isPublishable(player: PublishablePlayer): boolean {
    return player.active && player.remote_id !== null && player.is_public && player.online_status !== 'disabled';
}

/** Wait before the next try of a batch that failed `attempts` times: 1 min, 2, 4... up to 1 hour. */
export function backoffMs(attempts: number): number {
    return Math.min(BACKOFF_BASE_MS * 2 ** Math.max(attempts - 1, 0), BACKOFF_MAX_MS);
}

export interface QueueContext {
    romname: string;
    achievedAt: string;
    startupId: string | null;
    newId?: () => string;
    // The report on the game up to now (GameIntegrity.ts), joined to each score.
    integrity?: GameIntegrityReport;
}

/**
 * Queues the rows of publishable players, one per player (the best of the rows). Returns what was
 * queued.
 */
export async function queueScores(
    store: ScoreStore, players: PublishablePlayer[], rows: TableRow[], context: QueueContext,
): Promise<ScoreSubmission[]> {
    const remoteIds = new Map(players.filter(isPublishable).map(player => [player.pseudo_3, player.remote_id as string]));
    const best = new Map<string, TableRow>();
    for (const row of rows) {
        const playerId = remoteIds.get(scorePseudo3(row.name));
        if (playerId && row.score > (best.get(playerId)?.score ?? -1)) {
            best.set(playerId, row);
        }
    }
    const queued: ScoreSubmission[] = [];
    for (const [playerId, row] of best) {
        queued.push({
            id: (context.newId ?? randomUUID)(), playerId, romname: context.romname, score: row.score,
            rankOnCabinet: row.rank, achievedAt: context.achievedAt, startupId: context.startupId,
            ...(context.integrity ? {integrity: context.integrity} : {}),
        });
    }
    if (queued.length > 0) {
        await store.add(queued);
    }
    return queued;
}

/** Queues a score whose player was declared on the cabinet (ScoreDeclaration.ts). Returns it. */
export async function queueDeclaredScore(
    store: ScoreStore, playerId: string, row: TableRow, context: QueueContext,
): Promise<ScoreSubmission> {
    const submission: ScoreSubmission = {
        id: (context.newId ?? randomUUID)(), playerId, romname: context.romname, score: row.score,
        rankOnCabinet: row.rank, achievedAt: context.achievedAt, startupId: context.startupId,
        attribution: 'declared',
        ...(context.integrity ? {integrity: context.integrity} : {}),
    };
    await store.add([submission]);
    return submission;
}

export interface FlushSummary {
    sent: number;
    accepted: number;
    notImproved: number;
    rejected: Record<string, number>;
    // The batch that failed, and why: it waits for its next try, and the rest with it.
    failure?: ApiFailure;
}

/** Sends every score due, by batches, until none is left or a batch fails. */
export async function flushOutbox(store: ScoreStore, client: MauiApiClient, now: () => Date = () => new Date()): Promise<FlushSummary> {
    const summary: FlushSummary = {sent: 0, accepted: 0, notImproved: 0, rejected: {}};
    for (;;) {
        const batch = await store.due(now(), SCORE_BATCH_SIZE);
        if (batch.length === 0) {
            return summary;
        }
        const ids = batch.map(entry => entry.submission.id);
        const result = await client.postScores(batch.map(entry => entry.submission));
        if (result.kind !== 'ok') {
            // A batch MAUI-API refuses as a whole (422) would be refused forever: drop it.
            if (result.kind === 'rejected' && result.status === 422) {
                await store.remove(ids);
                summary.rejected[result.code] = (summary.rejected[result.code] ?? 0) + ids.length;
                continue;
            }
            const attempts = Math.max(...batch.map(entry => entry.attempts)) + 1;
            await store.reschedule(ids, attempts, new Date(now().getTime() + backoffMs(attempts)));
            return {...summary, failure: result};
        }
        await record(store, batch, result.value, summary);
    }
}

async function record(store: ScoreStore, batch: OutboxEntry[], results: ScoreResult[], summary: FlushSummary): Promise<void> {
    for (const result of results) {
        summary.sent++;
        if (result.status === 'accepted') {
            summary.accepted++;
        } else if (result.status === 'not_improved') {
            summary.notImproved++;
        } else {
            const code = result.code ?? 'unknown';
            summary.rejected[code] = (summary.rejected[code] ?? 0) + 1;
        }
    }
    // Answered: out of the outbox, even an id the answer left out (it would never get one).
    await store.remove(batch.map(entry => entry.submission.id));
}

/** One line for the BO: what MAUI-API did with the scores. */
export function describeFlush(summary: FlushSummary): string {
    const rejected = Object.entries(summary.rejected).map(([code, count]) => `${count} ${code}`).join(', ');
    return `${summary.sent} sent: ${summary.accepted} accepted, ${summary.notImproved} not improved`
        + `${rejected ? `, rejected: ${rejected}` : ''}.`;
}
