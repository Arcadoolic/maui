import {describe, it, expect} from 'vitest';
import {freshScores} from '@/class/ScoreReveal';
import type {BoardRow} from '@/class/LeaderboardSource';

const row = (key: string): BoardRow => ({key, player: key.slice(0, 3), pseudo3: key.slice(0, 3), score: 1, avatar: null});

describe('freshScores', () => {
    it('tells the rows a game added, two players included', () => {
        const before = ['NOB/9000', 'SAJ/7000'];
        expect(freshScores(before, [row('NOB/312000'), row('SAJ/154000'), row('NOB/9000'), row('SAJ/7000')]))
            .toEqual(['NOB/312000', 'SAJ/154000']);
    });

    it('tells nothing when the board did not change, or only lost rows', () => {
        expect(freshScores(['NOB/9000', 'SAJ/7000'], [row('NOB/9000'), row('SAJ/7000')])).toEqual([]);
        expect(freshScores(['NOB/9000', 'SAJ/7000'], [row('NOB/9000')])).toEqual([]);
    });
});
