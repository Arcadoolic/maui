import {describe, it, expect} from 'vitest';
import type {StartingPackManifest, StartingPackGameEntry} from '@/types/StartingPackManifest';
import {computePackOwnership, isPackFullyOwned, listPackGames} from '@/class/PackOwnership';

const game = (romName: string, fullname: string, hasRomFile = true) => ({
    romName, fullname, hasRomFile,
}) as StartingPackGameEntry;

const manifest = (games: StartingPackGameEntry[]): StartingPackManifest => ({
    formatVersion: 1, generatedAt: '2026-09-19T20:44:59.154Z', games, biosRoms: [],
});

describe('computePackOwnership', () => {
    const pack = manifest([game('asteroid', 'Asteroids (rev 4)'), game('centiped', 'Centipede'), game('pong', 'Pong', false)]);

    it('reports every game as owned when all the zips are installed', () => {
        const result = computePackOwnership(pack, ['asteroid', 'centiped', 'dkong']);

        expect(result).toEqual({total: 2, owned: 2, missing: []});
        expect(isPackFullyOwned(result)).toBe(true);
    });

    it('lists what an updated pack adds on top of what is installed', () => {
        const result = computePackOwnership(pack, ['asteroid']);

        expect(result).toEqual({total: 2, owned: 1, missing: ['Centipede']});
        expect(isPackFullyOwned(result)).toBe(false);
    });

    it('reports nothing owned for a pack that was never imported', () => {
        expect(computePackOwnership(pack, [])).toEqual({total: 2, owned: 0, missing: ['Asteroids (rev 4)', 'Centipede']});
    });

    it('ignores games without a rom file of their own', () => {
        expect(computePackOwnership(pack, ['asteroid', 'centiped'])?.total).toBe(2);
    });

    it('matches rom names whatever their case', () => {
        expect(computePackOwnership(pack, ['ASTEROID', 'Centiped'])?.missing).toEqual([]);
    });

    it('cannot compare a pack whose games ship no rom file', () => {
        expect(computePackOwnership(manifest([game('pong', 'Pong', false)]), [])).toBeNull();
    });

    it('cannot compare a fallback or missing manifest', () => {
        expect(computePackOwnership({formatVersion: null, games: []} as never, ['asteroid'])).toBeNull();
        expect(computePackOwnership(null, ['asteroid'])).toBeNull();
        expect(isPackFullyOwned(null)).toBe(false);
    });
});

describe('listPackGames', () => {
    const pack = manifest([
        {...game('centiped', 'Centipede'), year: '1980', manufacturer: 'Atari', categoryName: 'Shooter'},
        game('asteroid', 'Asteroids (rev 4)'),
        game('pong', 'Pong', false),
    ]);

    it('flags each game against the installed roms, sorted by name', () => {
        const result = listPackGames(pack, ['asteroid']);

        expect(result.map(entry => [entry.fullname, entry.status])).toEqual([
            ['Asteroids (rev 4)', 'installed'],
            ['Centipede', 'new'],
            ['Pong', 'no-rom'],
        ]);
    });

    it('carries the details shown in the list', () => {
        expect(listPackGames(pack, []).find(entry => entry.romName === 'centiped')).toMatchObject({
            year: '1980', manufacturer: 'Atari', categoryName: 'Shooter',
        });
    });

    it('is empty for an unreadable manifest', () => {
        expect(listPackGames(null, [])).toEqual([]);
        expect(listPackGames({formatVersion: null, games: []} as never, [])).toEqual([]);
    });
});
