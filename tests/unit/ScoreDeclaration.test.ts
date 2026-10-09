import {describe, it, expect} from 'vitest';
import {ScoreDeclarations} from '@/class/ScoreDeclaration';
import type {OutboxEntry, PublishablePlayer, ScoreStore} from '@/class/ScoreOutbox';
import type {ScoreSubmission} from '@/class/MauiApiClient';

class MemoryStore implements ScoreStore {
    public added: ScoreSubmission[] = [];
    public bests = new Map<string, number>();

    public async add(submissions: ScoreSubmission[]) {
        this.added.push(...submissions);
    }

    public async due(): Promise<OutboxEntry[]> {
        return [];
    }

    public async remove() {}

    public async reschedule() {}

    public async getBest(playerId: string, romname: string, table: string) {
        return this.bests.get(`${playerId}/${romname}/${table}`) ?? null;
    }

    public async setBest(playerId: string, romname: string, table: string, best: number) {
        this.bests.set(`${playerId}/${romname}/${table}`, best);
    }
}

const player = (pseudo3: string, overrides: Partial<PublishablePlayer> = {}): PublishablePlayer => ({
    pseudo_3: pseudo3, active: true, remote_id: `id-${pseudo3}`, is_public: true, online_status: 'active', ...overrides,
});
const row = (rank: number, score: number, name = '') => ({rank, score, name});
const context = {achievedAt: '2026-10-09T10:00:00.000Z', startupId: 'startup-1'};

function harness(players: PublishablePlayer[]) {
    const store = new MemoryStore();
    let next = 0;
    const state = {players};
    const declarations = new ScoreDeclarations({store, players: async () => state.players, newId: () => `uuid-${++next}`});
    return {store, declarations, state};
}

const sent = (store: MemoryStore) => store.added.map(score => [score.playerId, score.score, score.rankOnCabinet, score.attribution]);

describe('ScoreDeclarations', () => {
    it('only holds the rows without a name, and none scoring 0', async () => {
        const {declarations} = harness([player('NOB'), player('SAJ')]);
        declarations.hold('scobra', [row(1, 19200, 'MAF'), row(2, 12900), row(3, 0)], context);

        expect((await declarations.settle('scobra')).ask?.scores).toEqual([{score: 12900, rank: 2}]);
    });

    it('has nothing to ask for a game that left no nameless score', async () => {
        const {declarations} = harness([player('NOB'), player('SAJ')]);

        expect(await declarations.settle('dkong')).toEqual({queued: 0, ask: null});
    });

    it('drops the scores when the cabinet has no publishable player', async () => {
        const {declarations, store} = harness([player('NOB', {is_public: false}), player('SAJ', {active: false})]);
        declarations.hold('scobra', [row(1, 12900)], context);

        expect(await declarations.settle('scobra')).toEqual({queued: 0, ask: null});
        expect(await declarations.attribute('scobra', 12900, 'id-NOB')).toBe(false);
        expect(store.added).toEqual([]);
    });

    it('gives the best score to the only publishable player, without asking', async () => {
        const {declarations, store} = harness([player('NOB'), player('SAJ', {is_public: false})]);
        declarations.hold('scobra', [row(3, 8000), row(1, 12900)], context);

        expect(await declarations.settle('scobra')).toEqual({queued: 1, ask: null});
        expect(sent(store)).toEqual([['id-NOB', 12900, 1, 'declared']]);
        expect(store.added[0]).toMatchObject({id: 'uuid-1', romname: 'scobra', ...context});
    });

    it('asks, best score first, when several players could have made them', async () => {
        const {declarations, store} = harness([player('SAJ'), player('PRV', {is_public: false}), player('NOB')]);
        declarations.hold('scobra', [row(3, 8000)], context);
        declarations.hold('scobra', [row(1, 12900)], context);

        expect(await declarations.settle('scobra')).toEqual({queued: 0, ask: {
            romname: 'scobra',
            scores: [{score: 12900, rank: 1}, {score: 8000, rank: 3}],
            players: [{remoteId: 'id-NOB', pseudo3: 'NOB'}, {remoteId: 'id-SAJ', pseudo3: 'SAJ'}],
        }});
        expect(store.added).toEqual([]);
    });

    it('queues a score for the player picked, once', async () => {
        const {declarations, store} = harness([player('NOB'), player('SAJ')]);
        declarations.hold('scobra', [row(1, 12900)], context);
        await declarations.settle('scobra');

        expect(await declarations.attribute('scobra', 12900, 'id-SAJ')).toBe(true);
        expect(await declarations.attribute('scobra', 12900, 'id-SAJ')).toBe(false);
        expect(sent(store)).toEqual([['id-SAJ', 12900, 1, 'declared']]);
    });

    it('drops a score nobody claims', async () => {
        const {declarations, store} = harness([player('NOB'), player('SAJ')]);
        declarations.hold('scobra', [row(1, 12900)], context);
        await declarations.settle('scobra');

        expect(await declarations.attribute('scobra', 12900, null)).toBe(false);
        expect(await declarations.attribute('scobra', 12900, 'id-NOB')).toBe(false);
        expect(store.added).toEqual([]);
    });

    it('only sends the best of what one player claims', async () => {
        const {declarations, store} = harness([player('NOB'), player('SAJ')]);
        declarations.hold('scobra', [row(1, 12900), row(2, 9000), row(3, 8000)], context);
        await declarations.settle('scobra');

        expect(await declarations.attribute('scobra', 12900, 'id-NOB')).toBe(true);
        expect(await declarations.attribute('scobra', 9000, 'id-SAJ')).toBe(true);
        expect(await declarations.attribute('scobra', 8000, 'id-NOB')).toBe(false);
        expect(sent(store).map(([playerId, score]) => [playerId, score])).toEqual([['id-NOB', 12900], ['id-SAJ', 9000]]);
    });

    it('does not send what does not beat the best MAUI-API knows', async () => {
        const {declarations, store} = harness([player('NOB'), player('SAJ')]);
        store.bests.set('id-NOB/scobra/default', 20000);
        declarations.hold('scobra', [row(1, 12900)], context);
        await declarations.settle('scobra');

        expect(await declarations.attribute('scobra', 12900, 'id-NOB')).toBe(false);
        expect(store.added).toEqual([]);
    });

    it('refuses a player who is not publishable anymore, or unknown', async () => {
        const {declarations, store, state} = harness([player('NOB'), player('SAJ')]);
        declarations.hold('scobra', [row(1, 12900), row(2, 9000)], context);
        await declarations.settle('scobra');
        state.players = [player('NOB', {active: false}), player('SAJ')];

        expect(await declarations.attribute('scobra', 12900, 'id-NOB')).toBe(false);
        expect(await declarations.attribute('scobra', 9000, 'id-XXX')).toBe(false);
        expect(store.added).toEqual([]);
    });

    it('forgets what a game left when it is started again', async () => {
        const {declarations} = harness([player('NOB'), player('SAJ')]);
        declarations.hold('scobra', [row(1, 12900)], context);
        declarations.reset('scobra');

        expect(await declarations.settle('scobra')).toEqual({queued: 0, ask: null});
    });
});
