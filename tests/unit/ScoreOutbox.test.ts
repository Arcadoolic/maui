import {describe, it, expect, vi} from 'vitest';
import {
    backoffMs, describeFlush, flushOutbox, isPublishable, queueScores, SCORE_BATCH_SIZE,
    type OutboxEntry, type PublishablePlayer, type ScoreStore,
} from '@/class/ScoreOutbox';
import type {ApiResult, MauiApiClient, ScoreResult, ScoreSubmission} from '@/class/MauiApiClient';

class MemoryStore implements ScoreStore {
    public entries = new Map<string, OutboxEntry & {nextAt: number}>();
    public bests = new Map<string, number>();

    public async add(submissions: ScoreSubmission[]) {
        submissions.forEach(submission => this.entries.set(submission.id, {submission, attempts: 0, nextAt: 0}));
    }

    public async due(now: Date, limit: number) {
        return [...this.entries.values()].filter(entry => entry.nextAt <= now.getTime()).slice(0, limit);
    }

    public async remove(ids: string[]) {
        ids.forEach(id => this.entries.delete(id));
    }

    public async reschedule(ids: string[], attempts: number, nextAttemptAt: Date) {
        ids.forEach(id => Object.assign(this.entries.get(id)!, {attempts, nextAt: nextAttemptAt.getTime()}));
    }

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
const row = (rank: number, score: number, name: string) => ({rank, score, name});
let next = 0;
const context = {romname: 'dkong', achievedAt: '2026-10-02T10:00:00.000Z', startupId: 'startup-1', newId: () => `uuid-${++next}`};

const clientAnswering = (answer: (batch: ScoreSubmission[]) => ApiResult<ScoreResult[]>) => {
    const postScores = vi.fn(async (batch: ScoreSubmission[]) => answer(batch));
    return {client: {postScores} as unknown as MauiApiClient, postScores};
};

describe('isPublishable', () => {
    it('keeps the active, public players linked to MAUI-API and not disabled there', () => {
        expect(isPublishable(player('NOB'))).toBe(true);
        expect(isPublishable(player('NOB', {online_status: 'locked'}))).toBe(true);
        expect(isPublishable(player('NOB', {is_public: false}))).toBe(false);
        expect(isPublishable(player('NOB', {active: false}))).toBe(false);
        expect(isPublishable(player('NOB', {remote_id: null}))).toBe(false);
        expect(isPublishable(player('NOB', {online_status: 'disabled'}))).toBe(false);
    });
});

describe('queueScores', () => {
    it('queues the best row of each publishable player', async () => {
        const store = new MemoryStore();
        const queued = await queueScores(store, [player('NOB'), player('SAJ', {is_public: false})], [
            row(2, 12900, 'NOB'), row(4, 12200, 'nob'), row(5, 10500, 'SAJ'), row(1, 19200, 'MAF'),
        ], context);

        expect(queued.map(score => [score.playerId, score.score, score.rankOnCabinet, score.startupId]))
            .toEqual([['id-NOB', 12900, 2, 'startup-1']]);
        expect(store.entries.size).toBe(1);
    });

    it('skips what does not beat the cached best', async () => {
        const store = new MemoryStore();
        await store.setBest('id-NOB', 'dkong', 'default', 12900);

        expect(await queueScores(store, [player('NOB')], [row(1, 12900, 'NOB')], context)).toEqual([]);
        expect(await queueScores(store, [player('NOB')], [row(1, 13000, 'NOB')], context)).toHaveLength(1);
    });
});

describe('flushOutbox', () => {
    it('sends by batches, empties the outbox and caches the bests', async () => {
        const store = new MemoryStore();
        await store.add(Array.from({length: SCORE_BATCH_SIZE + 1}, (_, i) => ({
            id: `s${i}`, playerId: `p${i}`, romname: 'dkong', score: i, achievedAt: context.achievedAt,
        })));
        const {client, postScores} = clientAnswering(batch => ({kind: 'ok', value: batch.map(score => score.id === 's0'
            ? {id: score.id, status: 'rejected' as const, code: 'player_disabled'}
            : {id: score.id, status: 'accepted' as const, best: score.score})}));

        const summary = await flushOutbox(store, client);

        expect(postScores).toHaveBeenCalledTimes(2);
        expect(summary).toEqual({sent: 101, accepted: 100, notImproved: 0, rejected: {player_disabled: 1}});
        expect(store.entries.size).toBe(0);
        expect(await store.getBest('p7', 'dkong', 'default')).toBe(7);
    });

    it('keeps a failed batch for later, waiting longer after each failure', async () => {
        const store = new MemoryStore();
        await store.add([{id: 's1', playerId: 'p', romname: 'dkong', score: 1, achievedAt: context.achievedAt}]);
        const {client} = clientAnswering(() => ({kind: 'unavailable', reason: 'network'}));
        const now = new Date('2026-10-02T10:00:00.000Z');

        const summary = await flushOutbox(store, client, () => now);
        expect(summary.failure).toEqual({kind: 'unavailable', reason: 'network'});
        expect(store.entries.get('s1')).toMatchObject({attempts: 1, nextAt: now.getTime() + 60_000});

        await flushOutbox(store, client, () => new Date(now.getTime() + 60_000));
        expect(store.entries.get('s1')).toMatchObject({attempts: 2, nextAt: now.getTime() + 60_000 + 120_000});
    });

    it('drops a batch MAUI-API refuses as a whole', async () => {
        const store = new MemoryStore();
        await store.add([{id: 's1', playerId: 'p', romname: 'dkong', score: 1, achievedAt: context.achievedAt}]);
        const {client} = clientAnswering(() => ({kind: 'rejected', status: 422, code: 'validation_failed'}));

        const summary = await flushOutbox(store, client);

        expect(summary.rejected).toEqual({validation_failed: 1});
        expect(store.entries.size).toBe(0);
    });
});

describe('backoffMs', () => {
    it('doubles from a minute up to an hour', () => {
        expect([1, 2, 3, 7, 8, 20].map(backoffMs)).toEqual([60_000, 120_000, 240_000, 3_600_000, 3_600_000, 3_600_000]);
    });
});

describe('describeFlush', () => {
    it('sums the outcomes up', () => {
        expect(describeFlush({sent: 3, accepted: 1, notImproved: 1, rejected: {player_disabled: 1}}))
            .toBe('3 sent: 1 accepted, 1 not improved, rejected: 1 player_disabled.');
    });
});
