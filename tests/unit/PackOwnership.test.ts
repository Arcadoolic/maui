import {describe, it, expect} from 'vitest';
import type {StartingPackManifest, StartingPackGameEntry} from '@/types/StartingPackManifest';
import {
    computeBiosSizes, computePackOwnership, getRequiredRoms, groupSelectedGames, isPackFullyOwned, listPackGames,
    manifestEntrySizes,
} from '@/class/PackOwnership';

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

describe('pack sizes', () => {
    const pack = {
        ...manifest([
            {...game('centiped', 'Centipede'), hasMarquee: true, hasFlyer: false, hasLogo: true, biosName: 'atarisy1'},
            {...game('pong', 'Pong', false), hasMarquee: false, hasFlyer: false, hasLogo: false},
        ]),
        biosRoms: ['atarisy1'],
    };
    const sizes = new Map([
        ['roms/centiped.zip', 1000], ['marquees/centiped.png', 50], ['logos/centiped.png', 5],
        ['flyers/centiped.png', 9999], ['roms/atarisy1.zip', 400],
    ]);

    it('sizes a game from the entries it ships (rom, marquee, flyer, logo)', () => {
        const result = listPackGames(pack, [], sizes);

        expect(result.find(entry => entry.romName === 'centiped')).toMatchObject({size: 1055, biosName: 'atarisy1'});
        expect(result.find(entry => entry.romName === 'pong')?.size).toBe(0);
    });

    it('spreads the pack size over its games when the entry sizes are unknown', () => {
        expect(listPackGames(pack, [], null, 1000).map(entry => entry.size)).toEqual([500, 500]);
    });

    it('sizes the bios sets the pack ships', () => {
        expect(computeBiosSizes(pack, sizes)).toEqual({atarisy1: 400});
        expect(computeBiosSizes(pack, null)).toEqual({});
    });
});

describe('getRequiredRoms', () => {
    it('takes the whole dependency list when the pack has one', () => {
        expect(getRequiredRoms({biosName: 'mslug', requiredRoms: ['mslug', 'neogeo']})).toEqual(['mslug', 'neogeo']);
        expect(getRequiredRoms({biosName: null, requiredRoms: ['qsound_hle']})).toEqual(['qsound_hle']);
    });

    it('falls back to biosName in a pack built before requiredRoms', () => {
        expect(getRequiredRoms({biosName: 'neogeo'})).toEqual(['neogeo']);
        expect(getRequiredRoms({biosName: null})).toEqual([]);
    });

    it('counts a game\'s sample set in its size', () => {
        const pack = manifest([{...game('qbert', 'Q*bert'), sampleSet: 'qbert'}]);
        const sizes = new Map([['roms/qbert.zip', 100], ['samples/qbert.zip', 800]]);

        expect(listPackGames(pack, [], sizes)[0].size).toBe(900);
    });

    it('carries the ScreenScraper publisher when the pack has one', () => {
        const pack = manifest([{...game('mslug', 'Metal Slug'), publisher: 'SNK'}, game('pong', 'Pong', false)]);

        expect(listPackGames(pack, []).map(entry => entry.publisher)).toEqual(['SNK', null]);
    });

    it('lists them on each pack game', () => {
        const pack = manifest([{...game('19xx', '19XX'), biosName: null, requiredRoms: ['qsound_hle']}]);

        expect(listPackGames(pack, [])[0].requiredRoms).toEqual(['qsound_hle']);
    });
});

describe('groupSelectedGames', () => {
    it('groups the ticked games by pack, in page order', () => {
        const result = groupSelectedGames(['a-pack.zip|alpha', 'b-pack.zip|delta', 'a-pack.zip|beta']);

        expect([...(result ?? [])]).toEqual([['a-pack.zip', ['alpha', 'beta']], ['b-pack.zip', ['delta']]]);
    });

    it('accepts the single string a lone ticked box gives', () => {
        expect([...(groupSelectedGames('a-pack.zip|alpha') ?? [])]).toEqual([['a-pack.zip', ['alpha']]]);
    });

    it('keeps a game listed by two packs for the first one only', () => {
        const result = groupSelectedGames(['a-pack.zip|dkong', 'b-pack.zip|dkong', 'b-pack.zip|mario']);

        expect([...(result ?? [])]).toEqual([['a-pack.zip', ['dkong']], ['b-pack.zip', ['mario']]]);
    });

    it('is empty when nothing is ticked', () => {
        expect(groupSelectedGames(undefined)?.size).toBe(0);
    });

    it.each([
        ['a path in the pack name', '../x.zip|alpha'],
        ['a pack that is not a zip', 'a-pack.tar|alpha'],
        ['shell metacharacters in the rom name', 'a-pack.zip|alpha;rm -rf'],
        ['a missing rom name', 'a-pack.zip|'],
        ['a missing separator', 'a-pack.zip'],
        ['an extra part', 'a-pack.zip|alpha|beta'],
    ])('refuses %s', (_label, value) => {
        expect(groupSelectedGames([value])).toBeNull();
    });

    it('refuses anything that is not a string', () => {
        expect(groupSelectedGames([{pack: 'a-pack.zip'}])).toBeNull();
    });
});

describe('manifestEntrySizes', () => {
    const file = (name: string, size: number) => ({name, offset: 0, compressedSize: size, size, method: 0 as const, crc32: 0});
    const described = {
        ...manifest([game('dkong', 'Donkey Kong')]),
        zip: {size: 5000, mtime: 1790440985},
        files: [file('roms/dkong.zip', 4000), file('flyers/dkong.png', 900)],
    };

    it('gives the size of each entry the manifest lists', () => {
        expect([...(manifestEntrySizes(described, 5000) ?? [])]).toEqual([['roms/dkong.zip', 4000], ['flyers/dkong.png', 900]]);
    });

    it('feeds the per-game sizes without a look at the ZIP', () => {
        const pack = {...described, games: [{...game('dkong', 'Donkey Kong'), hasFlyer: true}]};

        expect(listPackGames(pack, [], manifestEntrySizes(pack, 5000))[0]?.size).toBe(4900);
    });

    it('is null for a manifest written before the repository listed the files', () => {
        expect(manifestEntrySizes(manifest([]), 5000)).toBeNull();
        expect(manifestEntrySizes(null, 5000)).toBeNull();
    });

    it('is null when the pack was re-published since the manifest was written', () => {
        expect(manifestEntrySizes(described, 6000)).toBeNull();
        expect(manifestEntrySizes({...described, zip: undefined}, 5000)).toBeNull();
    });

    it('is null when an entry makes no sense', () => {
        expect(manifestEntrySizes({...described, files: [file('roms/dkong.zip', -1)]}, 5000)).toBeNull();
        expect(manifestEntrySizes({...described, files: [{size: 10}] as never}, 5000)).toBeNull();
    });
});
