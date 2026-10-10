import {isPublishable, queueDeclaredScore, type PublishablePlayer, type ScoreStore} from '@/class/ScoreOutbox';
import type {PendingAttribution} from '@/class/ScoreCaptureBridge';
import type {TableRow} from '@/class/ScoreDiff';

// Scores a game wrote without any name (route16, scobra, the games keeping a single top score):
// the file cannot tell whose they are (maui-api D61). They are held while the game runs, then
// those still in the table when it ends are given to the cabinet's only publishable player, or
// asked on the cabinet when there are several (WhoPlayedModal.vue). Nothing is kept: a score
// nobody claims is dropped.

export interface ScoreDeclarationsDeps {
    store: ScoreStore;
    newId?: () => string;
    players(): Promise<PublishablePlayer[]>;
}

export interface HoldContext {
    achievedAt: string;
    startupId: string | null;
}

interface HeldScore extends HoldContext {
    row: TableRow;
}

interface HeldGame {
    scores: HeldScore[];
    // The best score each player was already given in this game: lower ones are not sent.
    given: Map<string, number>;
}

export interface Settlement {
    // Scores given to the only publishable player, and queued.
    queued: number;
    // What is left to ask on the cabinet, null when nothing is.
    ask: PendingAttribution | null;
}

/** The held scores the final table still has without a name, each row counting once. */
function stillInTable(scores: HeldScore[], table: TableRow[]): HeldScore[] {
    const left = new Map<number, number>();
    for (const row of table.filter(row => row.name === '')) {
        left.set(row.score, (left.get(row.score) ?? 0) + 1);
    }
    return scores.filter((held) => {
        const count = left.get(held.row.score) ?? 0;
        left.set(held.row.score, count - 1);
        return count > 0;
    });
}

export class ScoreDeclarations {
    private readonly games = new Map<string, HeldGame>();

    public constructor(private readonly deps: ScoreDeclarationsDeps) {}

    /** A game starts: what its last run left unanswered is forgotten. */
    public reset(romname: string): void {
        this.games.delete(romname);
    }

    /** Keeps the nameless rows among those a game just added. */
    public hold(romname: string, rows: TableRow[], context: HoldContext): void {
        const nameless = rows.filter(row => row.name === '' && row.score > 0);
        if (nameless.length === 0) {
            return;
        }
        const game = this.games.get(romname) ?? {scores: [], given: new Map<string, number>()};
        game.scores.push(...nameless.map(row => ({row, ...context})));
        game.scores.sort((left, right) => right.row.score - left.row.score);
        this.games.set(romname, game);
    }

    /**
     * The game ended: who gets what it held, or what to ask. `table` is the game's table as it
     * ended (null when it cannot be read): a held score it no longer has was only a step on the
     * way, a top score the game rewrote as it went up, and is nobody's.
     */
    public async settle(romname: string, table: TableRow[] | null = null): Promise<Settlement> {
        const game = this.games.get(romname);
        if (!game) {
            return {queued: 0, ask: null};
        }
        if (table) {
            game.scores = stillInTable(game.scores, table);
            if (game.scores.length === 0) {
                this.games.delete(romname);
                return {queued: 0, ask: null};
            }
        }
        const players = (await this.deps.players()).filter(isPublishable);
        if (players.length < 2) {
            this.games.delete(romname);
            let queued = 0;
            for (const held of players.length === 1 ? game.scores : []) {
                queued += await this.give(romname, game, held, players[0].remote_id as string) ? 1 : 0;
            }
            return {queued, ask: null};
        }
        return {queued: 0, ask: {
            romname,
            scores: game.scores.map(held => ({score: held.row.score, rank: held.row.rank})),
            players: players
                .map(player => ({remoteId: player.remote_id as string, pseudo3: player.pseudo_3}))
                .sort((left, right) => left.pseudo3.localeCompare(right.pseudo3)),
        }};
    }

    /**
     * The answer for one held score: the player picked on the cabinet, or null when nobody claimed
     * it. Says whether the score was queued for MAUI-API.
     */
    public async attribute(romname: string, score: number, playerId: string | null): Promise<boolean> {
        const game = this.games.get(romname);
        const index = game?.scores.findIndex(held => held.row.score === score) ?? -1;
        if (!game || index < 0) {
            return false;
        }
        const [held] = game.scores.splice(index, 1);
        if (game.scores.length === 0) {
            this.games.delete(romname);
        }
        if (playerId === null) {
            return false;
        }
        // Read again: the BO may have changed the player since the question was asked.
        const players = (await this.deps.players()).filter(isPublishable);
        if (!players.some(player => player.remote_id === playerId)) {
            return false;
        }
        return this.give(romname, game, held, playerId);
    }

    private async give(romname: string, game: HeldGame, held: HeldScore, playerId: string): Promise<boolean> {
        if (held.row.score <= (game.given.get(playerId) ?? -1)) {
            return false;
        }
        game.given.set(playerId, held.row.score);
        const queued = await queueDeclaredScore(this.deps.store, playerId, held.row, {
            romname, achievedAt: held.achievedAt, startupId: held.startupId, newId: this.deps.newId,
        });
        return queued !== null;
    }
}
