import * as SequelizeTS from 'sequelize-typescript';
import {QueryTypes} from 'sequelize';
import type {OpinionStore, StoredOpinion} from '@/class/OpinionReport';

type Sequelize = SequelizeTS.Sequelize;

interface GameRow {
    romName: string;
    vote: number;
    play_count: number;
    last_played_at: string | null;
    opinion_sent: string | null;
}

// OpinionStore on the app's SQLite database: the game table, with its opinion_sent column
// (migrations/20261010200000-game-opinion-sent.js). Read in plain SQL so that the games removed
// from the favorites (soft-deleted, which the Game model leaves out) are there too.

export class SqliteOpinionStore implements OpinionStore {
    public constructor(private readonly sequelize: Sequelize) {}

    public async all(): Promise<StoredOpinion[]> {
        const rows = await this.sequelize.query<GameRow>(
            'SELECT romName, vote, play_count, last_played_at, opinion_sent FROM game WHERE vote <> 0 OR play_count > 0 ORDER BY romName',
            {type: QueryTypes.SELECT},
        );
        return rows.map(row => ({
            romname: row.romName,
            vote: row.vote,
            playCount: row.play_count,
            lastPlayedAt: toIso(row.last_played_at),
            sent: row.opinion_sent,
        }));
    }

    public async markSent(sent: Array<{romname: string; signature: string}>): Promise<void> {
        for (const {romname, signature} of sent) {
            await this.sequelize.query('UPDATE game SET opinion_sent = ? WHERE romName = ?', {replacements: [signature, romname]});
        }
    }
}

/** Sequelize writes its dates as "2026-10-10 14:35:36.507 +00:00": ISO 8601 for MAUI-API. */
function toIso(value: string | null): string | null {
    if (!value) {
        return null;
    }
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
}
