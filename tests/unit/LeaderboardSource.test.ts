import {describe, it, expect, vi} from 'vitest';

import {mkdtempSync, rmSync, utimesSync, writeFileSync} from 'fs';
import {tmpdir} from 'os';
import {join} from 'path';
import {lastScoredRomnames, localAvatarUrl, toBoardRows} from '@/class/LeaderboardSource';

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
            {key: 'id-NOB/300', player: 'id-NOB', pseudo3: 'NOB', score: 300, avatar: 'file:///h1.png'},
            {key: 'id-SKI/200', player: 'id-SKI', pseudo3: 'SKI', score: 200, avatar: null},
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

describe('localAvatarUrl', () => {
    it('gives the file a new address each time its picture is replaced', () => {
        const dir = mkdtempSync(join(tmpdir(), 'maui-avatars-'));
        try {
            const file = join(dir, 'NOB.png');
            writeFileSync(file, 'first');
            utimesSync(file, new Date(1_700_000_000_000), new Date(1_700_000_000_000));
            const first = localAvatarUrl(dir, 'NOB');
            expect(first).toMatch(/^file:\/\/.*NOB\.png\?v=1700000000000$/);
            expect(localAvatarUrl(dir, 'NOB')).toBe(first);

            // The same file, overwritten: what a new avatar is.
            writeFileSync(file, 'second');
            utimesSync(file, new Date(1_700_000_060_000), new Date(1_700_000_060_000));
            expect(localAvatarUrl(dir, 'NOB')).toMatch(/NOB\.png\?v=1700000060000$/);
        } finally {
            rmSync(dir, {recursive: true, force: true});
        }
    });

    it('is null without a file, and never leaves the avatars folder', () => {
        const dir = mkdtempSync(join(tmpdir(), 'maui-avatars-'));
        try {
            expect(localAvatarUrl(dir, 'SKI')).toBeNull();
            expect(localAvatarUrl(dir, '../NOB')).toBeNull();
        } finally {
            rmSync(dir, {recursive: true, force: true});
        }
    });
});
