import {describe, expect, it} from 'vitest';
import {parseVerifyRoms} from '@/class/MameVerifyRoms';

describe('parseVerifyRoms', () => {
    it('reads the verdict of each set, with the files at fault of a bad one', () => {
        const verdicts = parseVerifyRoms([
            'romset atetris is good',
            'dkong       : c-2j.bpr (256 bytes) - NOT FOUND',
            'romset dkong is bad',
            'mslug       : sfix.sfix (131072 bytes) - NOT FOUND (neogeo)',
            'mslug       : 000-lo.lo (131072 bytes) - NOT FOUND (neogeo)',
            'romset mslug [neogeo] is bad',
            "No matching systems found for 'zzznope'",
            '',
        ].join('\n'));

        expect(verdicts.get('atetris')).toEqual({status: 'good'});
        expect(verdicts.get('dkong')).toEqual({status: 'bad', problems: ['c-2j.bpr (256 bytes) - NOT FOUND']});
        expect(verdicts.get('mslug')).toEqual({
            status: 'bad',
            problems: ['sfix.sfix (131072 bytes) - NOT FOUND (neogeo)', '000-lo.lo (131072 bytes) - NOT FOUND (neogeo)'],
        });
        expect(verdicts.get('zzznope')).toEqual({status: 'unknown'});
    });

    it('takes a set whose missing files have no known good dump as good', () => {
        const verdicts = parseVerifyRoms([
            'bublbobl    : pal16l8.bin (1 bytes) - NOT FOUND - NO GOOD DUMP KNOWN',
            'romset bublbobl is best available',
            '34 romsets found, 34 were OK.',
        ].join('\r\n'));

        expect([...verdicts]).toEqual([['bublbobl', {status: 'good'}]]);
    });

    it('says nothing of a set that is not in the rompath', () => {
        expect(parseVerifyRoms('romset puckman is good\n').has('klax')).toBe(false);
    });
});
