import * as SequelizeTS from 'sequelize-typescript';
import {QueryTypes} from 'sequelize';
import type {ScoreSubmission} from '@/class/MauiApiClient';
import type {OutboxEntry, ScoreStore} from '@/class/ScoreOutbox';
import type {Leaderboard} from '@/class/MauiApiClient';
import type {LeaderboardStore} from '@/class/LeaderboardSync';

type Sequelize = SequelizeTS.Sequelize;

// ScoreStore on the app's SQLite database: tables score_outbox and online_best
// (migrations/20261002120000-score-outbox.js). Dates are ISO strings, which sort as dates.

export class SqliteScoreStore implements ScoreStore {
    public constructor(private readonly sequelize: Sequelize) {}

    public async add(submissions: ScoreSubmission[]): Promise<void> {
        const now = new Date().toISOString();
        for (const submission of submissions) {
            await this.sequelize.query(
                'INSERT OR IGNORE INTO score_outbox (id, payload, attempts, next_attempt_at, created_at) VALUES (?, ?, 0, ?, ?)',
                {replacements: [submission.id, JSON.stringify(submission), now, now]},
            );
        }
    }

    public async due(now: Date, limit: number): Promise<OutboxEntry[]> {
        const rows = await this.sequelize.query<{payload: string; attempts: number}>(
            'SELECT payload, attempts FROM score_outbox WHERE next_attempt_at <= ? ORDER BY created_at, id LIMIT ?',
            {replacements: [now.toISOString(), limit], type: QueryTypes.SELECT},
        );
        return rows.map(row => ({submission: JSON.parse(row.payload) as ScoreSubmission, attempts: Number(row.attempts)}));
    }

    public async remove(ids: string[]): Promise<void> {
        if (ids.length > 0) {
            await this.sequelize.query('DELETE FROM score_outbox WHERE id IN (?)', {replacements: [ids]});
        }
    }

    public async reschedule(ids: string[], attempts: number, nextAttemptAt: Date): Promise<void> {
        if (ids.length > 0) {
            await this.sequelize.query(
                'UPDATE score_outbox SET attempts = ?, next_attempt_at = ? WHERE id IN (?)',
                {replacements: [attempts, nextAttemptAt.toISOString(), ids]},
            );
        }
    }

    public async getBest(playerId: string, romname: string, table: string): Promise<number | null> {
        const rows = await this.sequelize.query<{best: number}>(
            'SELECT best FROM online_best WHERE player_id = ? AND romname = ? AND table_name = ?',
            {replacements: [playerId, romname, table], type: QueryTypes.SELECT},
        );
        return rows.length > 0 ? Number(rows[0].best) : null;
    }

    public async setBest(playerId: string, romname: string, table: string, best: number): Promise<void> {
        await this.sequelize.query(
            'INSERT INTO online_best (player_id, romname, table_name, best) VALUES (?, ?, ?, ?) '
            + 'ON CONFLICT (player_id, romname, table_name) DO UPDATE SET best = excluded.best',
            {replacements: [playerId, romname, table, best]},
        );
    }

    /** Forgets every cached best (development: after maui-api's dev:reset-scores). */
    public async clearBests(): Promise<void> {
        await this.sequelize.query('DELETE FROM online_best');
    }

    /** Scores waiting, for the BO. */
    public async pending(): Promise<number> {
        const rows = await this.sequelize.query<{count: number}>(
            'SELECT COUNT(*) AS count FROM score_outbox', {type: QueryTypes.SELECT},
        );
        return Number(rows[0]?.count ?? 0);
    }
}

/** LeaderboardStore on table online_leaderboard (migrations/20261002150000-online-leaderboard.js). */
export class SqliteLeaderboardStore implements LeaderboardStore {
    public constructor(private readonly sequelize: Sequelize) {}

    public async save(leaderboards: Leaderboard[]): Promise<void> {
        const now = new Date().toISOString();
        for (const leaderboard of leaderboards) {
            await this.sequelize.query(
                'INSERT INTO online_leaderboard (romname, table_name, entries, updated_at) VALUES (?, ?, ?, ?) '
                + 'ON CONFLICT (romname, table_name) DO UPDATE SET entries = excluded.entries, updated_at = excluded.updated_at',
                {replacements: [leaderboard.romname, leaderboard.table, JSON.stringify(leaderboard.entries), now]},
            );
        }
    }
}
