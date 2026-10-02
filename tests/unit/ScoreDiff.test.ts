import {describe, it, expect} from 'vitest';
import {newRows} from '@/class/ScoreDiff';

const row = (rank: number, score: number, name: string) => ({rank, score, name});

describe('newRows', () => {
    it('finds the scores a game added, whatever their rank', () => {
        const before = [row(1, 19200, 'MAF'), row(2, 12900, 'NOB'), row(3, 12500, 'GUS')];
        const after = [row(1, 19200, 'MAF'), row(2, 15000, 'SKI'), row(3, 12900, 'NOB'), row(4, 12500, 'GUS')];

        expect(newRows(before, after)).toEqual([row(2, 15000, 'SKI')]);
    });

    it('counts identical rows as many times as they appear', () => {
        const before = [row(1, 5000, 'NOB')];
        const after = [row(1, 5000, 'NOB'), row(2, 5000, 'NOB')];

        expect(newRows(before, after)).toEqual([row(2, 5000, 'NOB')]);
    });

    it('finds nothing in an unchanged table, everything in a first one', () => {
        const table = [row(1, 100, 'NOB')];
        expect(newRows(table, table)).toEqual([]);
        expect(newRows([], table)).toEqual(table);
    });
});
