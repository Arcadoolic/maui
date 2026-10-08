import {describe, it, expect, vi} from 'vitest';

import {lastScoredRomnames, toBoardRows} from '@/class/LeaderboardSource';

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

describe('lastScoredRomnames', () => {
    const at = (achievedAt: string) => ({...entry(1, 'NOB', 100), achievedAt});
    const board = (romname: string, ...dates: string[]) => ({romname, entries: JSON.stringify(dates.map(at))});

    it('lists the games with a score, the one scored on last first', () => {
        expect(lastScoredRomnames([
            board('bombjack', '2026-10-02T08:20:09+00:00'),
            board('pacman'),
            // Its last score counts, wherever it ranks.
            board('bublbobl', '2026-10-01T10:00:00+00:00', '2026-10-05T16:07:52+00:00'),
            board('simpsons', '2026-10-06T11:51:34+00:00'),
        ])).toEqual(['simpsons', 'bublbobl', 'bombjack']);
    });

    it('orders by name the games scored on at the same time', () => {
        expect(lastScoredRomnames([
            board('sf2', '2026-10-02T08:00:00+00:00'),
            board('contra', '2026-10-02T08:00:00+00:00'),
        ])).toEqual(['contra', 'sf2']);
    });

    it('skips a damaged cache entry, and keeps a game whose date cannot be read, last', () => {
        expect(lastScoredRomnames([
            {romname: 'digdug', entries: '{not json'},
            board('marble', 'someday'),
            board('gravitar', '2026-10-02T08:00:00+00:00'),
        ])).toEqual(['gravitar', 'marble']);
    });
});
