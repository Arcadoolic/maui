import {describe, it, expect} from 'vitest';
import {findTooSlowGames, isWeakHardware, MIN_PI3_SPEED, parseForcedGames} from '@/class/GameSpeed';
import type {StartingPackGameEntry} from '@/types/StartingPackManifest';

const GIB = 1024 ** 3;
const games = (...romNames: string[]) => romNames.map(romName => ({romName}) as StartingPackGameEntry);

describe('isWeakHardware', () => {
    it('takes a machine with 2 GiB of memory or less for a Raspberry Pi 3', () => {
        expect(isWeakHardware(905 * 1024 ** 2)).toBe(true);
        expect(isWeakHardware(2 * GIB)).toBe(true);
        expect(isWeakHardware(4 * GIB)).toBe(false);
    });
});

describe('findTooSlowGames', () => {
    it('leaves out the games under the threshold, the ones on the edge included', () => {
        const tooSlow = findTooSlowGames({
            games: games('mwalk', 'mslug', 'dkong', 'sf2'),
            pi3Speeds: {mwalk: 52, mslug: 104, dkong: 123, sf2: MIN_PI3_SPEED},
        });

        expect([...tooSlow]).toEqual([
            ['mwalk', '52% of its speed on a Raspberry Pi 3'],
            ['mslug', '104% of its speed on a Raspberry Pi 3'],
        ]);
    });

    it('keeps a too slow game the cabinet\'s owner asked for all the same', () => {
        const tooSlow = findTooSlowGames({
            games: games('mwalk', 'mslug', 'dkong'),
            pi3Speeds: {mwalk: 52, mslug: 104, dkong: 123},
        }, new Set(['mslug', 'dkong']));

        expect([...tooSlow.keys()]).toEqual(['mwalk']);
    });

    it('keeps a game that was not measured, and every game of a manifest without speeds', () => {
        expect(findTooSlowGames({games: games('mwalk', 'new'), pi3Speeds: {mwalk: 150}}).size).toBe(0);
        expect(findTooSlowGames({games: games('mwalk')}).size).toBe(0);
        expect(findTooSlowGames({games: games('mwalk'), pi3Speeds: {mwalk: 'slow'} as unknown as Record<string, number>}).size).toBe(0);
    });

    it('does not take an inherited property for a speed', () => {
        expect(findTooSlowGames({games: games('constructor', 'toString'), pi3Speeds: {}}).size).toBe(0);
    });
});

describe('parseForcedGames', () => {
    it('reads one field or several, and drops what is not a rom name', () => {
        expect([...parseForcedGames('mslug')]).toEqual(['mslug']);
        expect([...parseForcedGames(['mslug', 'kof98', 'mslug'])]).toEqual(['mslug', 'kof98']);
        expect(parseForcedGames(undefined).size).toBe(0);
        expect(parseForcedGames(['../etc', 'pack.zip|mslug', '', 42]).size).toBe(0);
    });
});
