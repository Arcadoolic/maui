import {randomUUID} from 'crypto';
import type {ApiFailure, MauiApiClient, ScoreResult, ScoreSubmission} from '@/class/MauiApiClient';
import {scorePseudo3} from '@/class/HiscoreSupport';
import type {TableRow} from '@/class/ScoreDiff';

// Scores waiting for MAUI-API (maui-api D50, Lot 2.3). A score is queued once found (PlaySession),
// with its own UUID, and leaves the outbox once MAUI-API answered for it, whatever the answer:
// accepted, not_improved or rejected. A failed batch waits, longer after each failure, and is sent
// again with the same UUIDs: MAUI-API stores it only once. The best of each player, as MAUI-API
// answers it, is cached so that only what beats it is queued.

export const SCORE_BATCH_SIZE = 100;
export const DEFAULT_TABLE = 'default';

const BACKOFF_BASE_MS = 60_000;
const BACKOFF_MAX_MS = 3_600_000;

export interface OutboxEntry {
    submission: ScoreSubmission;
    attempts: number;
}

/** Where the outbox and the best cache live: SQLite in the app (SqliteScoreStore.ts). */
export interface ScoreStore {
    add(submissions: ScoreSubmission[]): Promise<void>;
    // Due at `now`, oldest first.
    due(now: Date, limit: number): Promise<OutboxEntry[]>;
    remove(ids: string[]): Promise<void>;
    reschedule(ids: string[], attempts: number, nextAttemptAt: Date): Promise<void>;
    getBest(playerId: string, romname: string, table: string): Promise<number | null>;
    setBest(playerId: string, romname: string, table: string, best: number): Promise<void>;
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
}

/**
 * Queues the rows of publishable players that beat their cached best, one per player (the best
 * of the rows). Returns what was queued.
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
        const cached = await store.getBest(playerId, context.romname, DEFAULT_TABLE);
        if (cached !== null && row.score <= cached) {
            continue;
        }
        queued.push({
            id: (context.newId ?? randomUUID)(), playerId, romname: context.romname, score: row.score,
            rankOnCabinet: row.rank, achievedAt: context.achievedAt, startupId: context.startupId,
        });
    }
    if (queued.length > 0) {
        await store.add(queued);
    }
    return queued;
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
    const sent = new Map(batch.map(entry => [entry.submission.id, entry.submission]));
    for (const result of results) {
        const submission = sent.get(result.id);
        summary.sent++;
        if (result.status === 'accepted') {
            summary.accepted++;
        } else if (result.status === 'not_improved') {
            summary.notImproved++;
        } else {
            const code = result.code ?? 'unknown';
            summary.rejected[code] = (summary.rejected[code] ?? 0) + 1;
        }
        if (submission && typeof result.best === 'number') {
            await store.setBest(submission.playerId, submission.romname, submission.table ?? DEFAULT_TABLE, result.best);
        }
    }
    // Answered: out of the outbox, even an id the answer left out (it would never get one).
    await store.remove([...sent.keys()]);
}

/** One line for the BO: what MAUI-API did with the scores. */
export function describeFlush(summary: FlushSummary): string {
    const rejected = Object.entries(summary.rejected).map(([code, count]) => `${count} ${code}`).join(', ');
    return `${summary.sent} sent: ${summary.accepted} accepted, ${summary.notImproved} not improved`
        + `${rejected ? `, rejected: ${rejected}` : ''}.`;
}
