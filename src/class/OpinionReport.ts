import type {ApiFailure, MauiApiClient} from '@/class/MauiApiClient';

// What the cabinet thinks of its games and how much they are played, for MAUI-API (maui-api D75,
// Lot 4.1): the vote (GameVote.ts) and the play count of every game voted on or played. MAUI-API
// replaces what it had for each game sent, so there is no queue: a game is due while its vote and
// plays differ from what MAUI-API last acknowledged (game.opinion_sent), and a report that fails
// leaves it due for the next one. Sent after the startup report and every heartbeat
// (OnlineSession), the games removed from the favorites included: a thumbs down removes the game,
// and it is the vote the other cabinets must still hear of. Electron-free.

export const OPINION_BATCH_SIZE = 500;

export interface GameOpinion {
    romname: string;
    // 1 thumbs up, 0 neutral, -1 thumbs down.
    vote: number;
    playCount: number;
    // ISO 8601, null when the game was never played.
    lastPlayedAt: string | null;
}

export interface StoredOpinion extends GameOpinion {
    // opinionSignature() of what MAUI-API last acknowledged, null when nothing was sent yet.
    sent: string | null;
}

/** Where the games and what was sent live: SQLite in the app (SqliteOpinionStore.ts). */
export interface OpinionStore {
    // Every game voted on or played, removed ones included.
    all(): Promise<StoredOpinion[]>;
    markSent(sent: Array<{romname: string; signature: string}>): Promise<void>;
}

/** What tells one state of a game from another: a change of any of the three sends it again. */
export function opinionSignature(opinion: GameOpinion): string {
    return `${opinion.vote}|${opinion.playCount}|${opinion.lastPlayedAt ?? ''}`;
}

/** The games MAUI-API does not have as they are now. */
export function dueOpinions(stored: StoredOpinion[]): GameOpinion[] {
    return stored.filter(opinion => opinion.sent !== opinionSignature(opinion));
}

export interface OpinionReportSummary {
    sent: number;
    // The batch that failed, and why: its games stay due, and the rest with them.
    failure?: ApiFailure;
}

/** Sends every game due, by batches, until none is left or a batch fails. */
export async function reportOpinions(store: OpinionStore, client: MauiApiClient): Promise<OpinionReportSummary> {
    const due = dueOpinions(await store.all());
    let sent = 0;
    for (let start = 0; start < due.length; start += OPINION_BATCH_SIZE) {
        const batch = due.slice(start, start + OPINION_BATCH_SIZE);
        const result = await client.putOpinions(batch);
        if (result.kind !== 'ok') {
            return {sent, failure: result};
        }
        await store.markSent(batch.map(opinion => ({romname: opinion.romname, signature: opinionSignature(opinion)})));
        sent += batch.length;
    }
    return {sent};
}
