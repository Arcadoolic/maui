import {describe, it, expect, vi} from 'vitest';
import {
    dueOpinions, opinionSignature, reportOpinions, OPINION_BATCH_SIZE,
    type GameOpinion, type OpinionStore, type StoredOpinion,
} from '@/class/OpinionReport';
import type {ApiResult, MauiApiClient} from '@/class/MauiApiClient';

class MemoryStore implements OpinionStore {
    public constructor(public games: StoredOpinion[]) {}

    public async all() {
        return this.games.map(game => ({...game}));
    }

    public async markSent(sent: Array<{romname: string; signature: string}>) {
        for (const {romname, signature} of sent) {
            this.games.find(game => game.romname === romname)!.sent = signature;
        }
    }
}

const game = (romname: string, overrides: Partial<StoredOpinion> = {}): StoredOpinion => ({
    romname, vote: 1, playCount: 3, lastPlayedAt: '2026-10-10T14:35:36.507Z', sent: null, ...overrides,
});

function clientAnswering(...answers: ApiResult<true>[]) {
    const putOpinions = vi.fn(async (_opinions: GameOpinion[]) => answers.shift() ?? {kind: 'ok', value: true} as const);
    return {client: {putOpinions} as unknown as MauiApiClient, putOpinions};
}

describe('dueOpinions', () => {
    it('keeps the games MAUI-API does not have as they are now', () => {
        const same = game('same');
        same.sent = opinionSignature(same);
        const voted = game('voted', {vote: -1});
        voted.sent = opinionSignature({...voted, vote: 0});
        const played = game('played', {playCount: 4});
        played.sent = opinionSignature({...played, playCount: 3});

        expect(dueOpinions([same, voted, played, game('new')]).map(due => due.romname)).toEqual(['voted', 'played', 'new']);
    });
});

describe('reportOpinions', () => {
    it('sends the games due and remembers what was acknowledged', async () => {
        const known = game('known');
        known.sent = opinionSignature(known);
        const store = new MemoryStore([known, game('hasamu', {vote: -1, playCount: 1, lastPlayedAt: null})]);
        const {client, putOpinions} = clientAnswering();

        expect(await reportOpinions(store, client)).toEqual({sent: 1});
        expect(putOpinions).toHaveBeenCalledTimes(1);
        expect(putOpinions.mock.calls[0][0]).toEqual([
            expect.objectContaining({romname: 'hasamu', vote: -1, playCount: 1, lastPlayedAt: null}),
        ]);

        // Nothing changed since: nothing to send.
        expect(await reportOpinions(store, client)).toEqual({sent: 0});
        expect(putOpinions).toHaveBeenCalledTimes(1);

        // One more play: that game only.
        store.games[1].playCount = 2;
        expect(await reportOpinions(store, client)).toEqual({sent: 1});
    });

    it('leaves the games due when MAUI-API does not answer', async () => {
        const store = new MemoryStore([game('dkong')]);
        const failure = {kind: 'unavailable', reason: 'network'} as const;
        const {client, putOpinions} = clientAnswering(failure);

        expect(await reportOpinions(store, client)).toEqual({sent: 0, failure});
        expect(store.games[0].sent).toBeNull();

        expect(await reportOpinions(store, client)).toEqual({sent: 1});
        expect(putOpinions).toHaveBeenCalledTimes(2);
    });

    it('sends by batches, and stops at the one that fails', async () => {
        const store = new MemoryStore(Array.from({length: OPINION_BATCH_SIZE + 2}, (_, index) => game(`game${index}`)));
        const failure = {kind: 'rate_limited', retryAfterSeconds: 30} as const;
        const {client, putOpinions} = clientAnswering({kind: 'ok', value: true}, failure);

        expect(await reportOpinions(store, client)).toEqual({sent: OPINION_BATCH_SIZE, failure});
        expect(putOpinions.mock.calls.map(call => call[0].length)).toEqual([OPINION_BATCH_SIZE, 2]);
        expect(store.games.filter(stored => stored.sent === null)).toHaveLength(2);
    });
});
