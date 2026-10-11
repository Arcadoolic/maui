import {describe, it, expect} from 'vitest';
import {splitGameTitle} from '@/class/GameTitle';

describe('splitGameTitle', () => {
    it('drops the bracketed part of MAME\'s description', () => {
        expect(splitGameTitle('Galaxian (Namco set 1)')).toEqual({shortname: 'Galaxian', subname: ''});
        expect(splitGameTitle('Moon Patrol')).toEqual({shortname: 'Moon Patrol', subname: ''});
        expect(splitGameTitle('Ufo Robo Dangar (4/09/1987)').shortname).toBe('Ufo Robo Dangar');
    });

    it('sets the subtitle apart', () => {
        expect(splitGameTitle('Robotron: 2084 (Release 5, solid blue label)').shortname).toBe('Robotron');
        expect(splitGameTitle('Street Fighter II - The World Warrior (World 910522)').shortname).toBe('Street Fighter II');
    });

    it('reads the ampersand MAME escapes', () => {
        expect(splitGameTitle('Rush &amp; Crash (Japan)').shortname).toBe('Rush & Crash');
    });
});
