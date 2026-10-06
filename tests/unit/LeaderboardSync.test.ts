import {describe, it, expect, vi} from 'vitest';
import {LeaderboardSync, LEADERBOARD_BATCH_SIZE} from '@/class/LeaderboardSync';
import type {ApiResult, Conditional, Leaderboard, MauiApiClient} from '@/class/MauiApiClient';

const board = (romname: string, avatar: string | null = null): Leaderboard => ({romname, table: 'default', entries: [{
    rank: 1, playerId: `p-${romname}`, pseudo3: 'NOB', avatar, score: 100, achievedAt: '2026-10-01T10:00:00+00:00', cabinet: 'c',
}]});

function harness(romnames: string[], answer: (batch: string[], etag: string | null) => ApiResult<Conditional<Leaderboard[]>>) {
    const saved: Leaderboard[] = [];
    const cached = new Set<string>();
    const getLeaderboards = vi.fn(async (batch: string[], etag: string | null) => answer(batch, etag));
    const getAvatar = vi.fn(async () => ({kind: 'ok' as const, value: new Uint8Array([1])}));
    const sync = new LeaderboardSync({
        store: {save: async boards => { saved.push(...boards); }},
        avatars: {has: hash => cached.has(hash), save: hash => { cached.add(hash); }},
        romnames: async () => romnames,
    });
    const client = {getLeaderboards, getAvatar} as unknown as MauiApiClient;
    return {sync, client, saved, cached, getLeaderboards, getAvatar};
}

describe('LeaderboardSync', () => {
    it('asks by batches of 100, saves the answers and tells the front', async () => {
        const romnames = Array.from({length: LEADERBOARD_BATCH_SIZE + 1}, (_, i) => `game${String(i).padStart(3, '0')}`);
        const h = harness(romnames, batch => ({kind: 'ok', value: {notModified: false, etag: '"e"', value: batch.map(r => board(r))}}));
        const listener = vi.fn();
        h.sync.onChange(listener);

        const result = await h.sync.refresh(h.client);

        expect(h.getLeaderboards).toHaveBeenCalledTimes(2);
        expect(h.saved).toHaveLength(101);
        expect(result.updated).toBe(101);
        expect(listener).toHaveBeenCalledTimes(1);
    });

    it('sends the ETag back, and a 304 changes nothing', async () => {
        const h = harness(['dkong'], (batch, etag) => etag === '"v1"'
            ? {kind: 'ok', value: {notModified: true}}
            : {kind: 'ok', value: {notModified: false, etag: '"v1"', value: [board('dkong')]}});
        const listener = vi.fn();
        h.sync.onChange(listener);

        await h.sync.refresh(h.client);
        const second = await h.sync.refresh(h.client);

        expect(h.getLeaderboards.mock.calls[1][1]).toBe('"v1"');
        expect(second.updated).toBe(0);
        expect(listener).toHaveBeenCalledTimes(1);
    });

    it('downloads each missing avatar once', async () => {
        const hash = 'a'.repeat(64);
        const h = harness(['dkong', 'galaga'], batch => ({kind: 'ok', value: {notModified: false, etag: null, value: batch.map(r => board(r, hash))}}));

        const result = await h.sync.refresh(h.client);

        expect(h.getAvatar).toHaveBeenCalledTimes(1);
        expect(h.cached.has(hash)).toBe(true);
        expect(result.avatars).toBe(1);
    });

    it('keeps the cache when MAUI-API cannot be reached', async () => {
        const h = harness(['dkong'], () => ({kind: 'unavailable', reason: 'network'}));

        const result = await h.sync.refresh(h.client);

        expect(result.failure).toEqual({kind: 'unavailable', reason: 'network'});
        expect(h.saved).toEqual([]);
    });
});
