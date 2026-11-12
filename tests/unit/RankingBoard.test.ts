import {describe, it, expect} from 'vitest';
import {mkdtempSync, readFileSync} from 'fs';
import {join} from 'path';
import {tmpdir} from 'os';
import {createHash} from 'crypto';
import {boardTimeline, fetchRankingAvatar, rankingAvatarUrl} from '@/class/RankingBoard';
import type {RankingLine} from '@/class/MauiApiClient';

const timings = {enterEveryMs: 100, enterMs: 500, holdMs: 1000, scrollEveryMs: 400, endMs: 2000, emptyMs: 3000};

describe('boardTimeline', () => {
    it('brings the players in one after the other, then ends after the hold', () => {
        expect(boardTimeline(3, 10, timings)).toEqual([
            {atMs: 0, kind: 'enter', index: 0},
            {atMs: 100, kind: 'enter', index: 1},
            {atMs: 200, kind: 'enter', index: 2},
            // The last one has crossed (200 + 500), then the end time.
            {atMs: 2700, kind: 'end'},
        ]);
    });

    it('scrolls through the players past the first ones once the board stood still', () => {
        expect(boardTimeline(4, 2, timings)).toEqual([
            {atMs: 0, kind: 'enter', index: 0},
            {atMs: 100, kind: 'enter', index: 1},
            {atMs: 1600, kind: 'scroll', index: 2},
            {atMs: 2000, kind: 'scroll', index: 3},
            {atMs: 4000, kind: 'end'},
        ]);
    });

    it('ends after a while with nobody to show', () => {
        expect(boardTimeline(0, 10, timings)).toEqual([{atMs: 3000, kind: 'end'}]);
    });
});

describe('ranking avatars', () => {
    const png = new Uint8Array([137, 80, 78, 71, 1, 2, 3]);
    const hash = createHash('sha256').update(png).digest('hex');
    const line: RankingLine = {rank: 1, playerId: 'p1', pseudo3: 'NOB', avatar: hash, points: 1, games: 1, crowns: 0, podiums: 1};

    it('downloads a missing avatar once, kept under its hash', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'maui-ranking-'));
        expect(rankingAvatarUrl(line, dir)).toBeNull();

        const url = await fetchRankingAvatar(line, async () => ({kind: 'ok', value: png}), dir);

        expect(url).toContain(`${hash}.png`);
        expect(new Uint8Array(readFileSync(join(dir, `${hash}.png`)))).toEqual(png);
        expect(rankingAvatarUrl(line, dir)).toBe(url);
    });

    it('keeps nothing whose content is not the picture its hash names', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'maui-ranking-'));

        expect(await fetchRankingAvatar(line, async () => ({kind: 'ok', value: new Uint8Array([1])}), dir)).toBeNull();
        expect(await fetchRankingAvatar({...line, avatar: null}, async () => ({kind: 'ok', value: png}), dir)).toBeNull();
        expect(rankingAvatarUrl(line, dir)).toBeNull();
    });
});
