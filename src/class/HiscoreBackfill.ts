import {randomUUID} from 'crypto';
import {existsSync, readdirSync, statSync} from 'fs';
import {join} from 'path';
import {MameHiExtractor} from '@arcadoolic/mhiex';
import type {ApiFailure, MauiApiClient, ScoreSubmission} from '@/class/MauiApiClient';
import {scorePseudo3} from '@/class/HiscoreSupport';

// Development only: sends the hiscores already on this cabinet (<mame home>/hiscore, nvram) to
// MAUI-API, to fill it with realistic data. Only the players active, public, linked and not
// disabled there: the same scores Lot 2.3 will send as they are made. maui-api's
// `php artisan dev:reset-scores` empties them again.

export const SCORE_BATCH_SIZE = 100;

export interface CabinetTable {
    romname: string;
    // When the file was written: the best guess of when its scores were made.
    achievedAt: string;
    rows: {rank: number; score: number; name: string}[];
}

export interface PublishablePlayer {
    pseudo_3: string;
    active: boolean;
    remote_id: string | null;
    is_public: boolean;
    online_status: string | null;
}

/** A player whose scores go to the shared leaderboards. */
export function isPublishable(player: PublishablePlayer): boolean {
    return player.active && player.remote_id !== null && player.is_public && player.online_status !== 'disabled';
}

/** The best score of each publishable player on each game, ready to send. */
export function selectBackfillScores(
    tables: CabinetTable[], players: PublishablePlayer[], newId: () => string = randomUUID,
): ScoreSubmission[] {
    const remoteIds = new Map(players.filter(isPublishable).map(player => [player.pseudo_3, player.remote_id as string]));
    const best = new Map<string, ScoreSubmission>();
    for (const table of tables) {
        for (const row of table.rows) {
            const playerId = remoteIds.get(scorePseudo3(row.name));
            const key = `${playerId}/${table.romname}`;
            if (!playerId || row.score <= (best.get(key)?.score ?? -1)) {
                continue;
            }
            best.set(key, {
                id: newId(), playerId, romname: table.romname, score: row.score,
                rankOnCabinet: row.rank, achievedAt: table.achievedAt,
            });
        }
    }
    return [...best.values()];
}

/** The default table of every game mhiex reads among the cabinet's .hi and nvram files. */
export async function readCabinetTables(mameHome: string): Promise<CabinetTable[]> {
    const extractor = new MameHiExtractor(mameHome);
    const listed = (dir: string, keep: (name: string) => string | null) => existsSync(join(mameHome, dir))
        ? readdirSync(join(mameHome, dir)).map(keep).filter((name): name is string => name !== null)
        : [];
    const romnames = new Set([
        ...listed('hiscore', name => name.endsWith('.hi') ? name.slice(0, -3) : null),
        ...listed('nvram', name => name),
    ]);
    const tables: CabinetTable[] = [];
    for (const romname of [...romnames].sort()) {
        const files = extractor.files(romname);
        if (!files) {
            continue;
        }
        const paths = [files.hi ? join('hiscore', `${romname}.hi`) : null, files.nvram]
            .filter((path): path is string => path !== null)
            .map(path => join(mameHome, path))
            .filter(existsSync);
        if (paths.length === 0) {
            continue;
        }
        try {
            const read = await extractor.get(romname);
            if (!read) {
                continue;
            }
            const writtenAt = Math.max(...paths.map(path => statSync(path).mtimeMs));
            tables.push({romname, achievedAt: new Date(writtenAt).toISOString(), rows: read.extract(false).scores.default});
        } catch {
            // A file mhiex cannot decode (another layout): nothing to send for this game.
        }
    }
    return tables;
}

export interface BackfillSummary {
    sent: number;
    accepted: number;
    notImproved: number;
    rejected: Record<string, number>;
    // The batch that failed, and why: the rest was not sent.
    failure?: ApiFailure;
}

export async function sendScores(client: MauiApiClient, scores: ScoreSubmission[]): Promise<BackfillSummary> {
    const summary: BackfillSummary = {sent: 0, accepted: 0, notImproved: 0, rejected: {}};
    for (let start = 0; start < scores.length; start += SCORE_BATCH_SIZE) {
        const result = await client.postScores(scores.slice(start, start + SCORE_BATCH_SIZE));
        if (result.kind !== 'ok') {
            return {...summary, failure: result};
        }
        for (const outcome of result.value) {
            summary.sent++;
            if (outcome.status === 'accepted') {
                summary.accepted++;
            } else if (outcome.status === 'not_improved') {
                summary.notImproved++;
            } else {
                const code = outcome.code ?? 'unknown';
                summary.rejected[code] = (summary.rejected[code] ?? 0) + 1;
            }
        }
    }
    return summary;
}

/** One line for the BO: what MAUI-API did with the scores. */
export function describeBackfill(found: number, summary: BackfillSummary): string {
    const rejected = Object.entries(summary.rejected).map(([code, count]) => `${count} ${code}`).join(', ');
    return `${found} best score(s) of public players found, ${summary.sent} sent: ${summary.accepted} accepted, `
        + `${summary.notImproved} not improved${rejected ? `, rejected: ${rejected}` : ''}.`;
}
