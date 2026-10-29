import {describe, it, expect} from 'vitest';
import {gameVolumeArgs, parseVolumePercent} from '@/class/Volume';

describe('parseVolumePercent', () => {
    it('takes an integer from 0 to 100, else the fallback', () => {
        expect(parseVolumePercent(0, 60)).toBe(0);
        expect(parseVolumePercent('35', 60)).toBe(35);
        expect(parseVolumePercent(100, 60)).toBe(100);
        for (const value of [undefined, '', ' ', 'loud', 101, -1, 12.5, null]) {
            expect(parseVolumePercent(value, 60)).toBe(60);
        }
    });
});

describe('gameVolumeArgs', () => {
    it('leaves MAME at its own level at 100%', () => {
        expect(gameVolumeArgs(100)).toEqual([]);
    });

    it('turns a percentage of the amplitude into MAME\'s decibels', () => {
        expect(gameVolumeArgs(50)).toEqual(['-volume', '-6']);
        expect(gameVolumeArgs(10)).toEqual(['-volume', '-20']);
        expect(gameVolumeArgs(1)).toEqual(['-volume', '-40']);
    });

    it('is silent at 0%, MAME\'s lowest', () => {
        expect(gameVolumeArgs(0)).toEqual(['-volume', '-96']);
    });
});
