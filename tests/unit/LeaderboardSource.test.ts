import {describe, it, expect, vi} from 'vitest';

import {toBoardRows} from '@/class/LeaderboardSource';

vi.mock('electron', () => ({ipcRenderer: {on: vi.fn(), off: vi.fn()}}));
vi.mock('@/services', () => ({getConfiguration: vi.fn(), getUserService: vi.fn()}));

const entry = (rank: number, pseudo3: string, score: number, avatar: string | null = null) => ({
    rank, playerId: `id-${pseudo3}`, pseudo3, avatar, score, achievedAt: '2026-10-01T10:00:00+00:00', cabinet: 'c',
});

describe('toBoardRows', () => {
    it('turns the cached entries into rows, limit at most, with their avatar', () => {
        const json = JSON.stringify([entry(1, 'NOB', 300, 'h1'), entry(2, 'SKI', 200), entry(3, 'CAP', 100)]);
        const avatarOf = vi.fn((pseudo3: string, hash: string | null) => hash ? `file:///${hash}.png` : null);

        expect(toBoardRows(json, 2, avatarOf)).toEqual([
            {key: 'id-NOB/300', pseudo3: 'NOB', score: 300, avatar: 'file:///h1.png'},
            {key: 'id-SKI/200', pseudo3: 'SKI', score: 200, avatar: null},
        ]);
        expect(avatarOf).toHaveBeenCalledWith('NOB', 'h1');
    });

    it('shows nothing for a game not cached yet, or a damaged cache', () => {
        expect(toBoardRows(null, 9, () => null)).toEqual([]);
        expect(toBoardRows('{not json', 9, () => null)).toEqual([]);
    });
});
