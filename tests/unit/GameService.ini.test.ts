import {describe, it, expect, beforeAll, afterAll, afterEach} from 'vitest';
import {mkdtempSync, rmSync, writeFileSync} from 'fs';
import {join} from 'path';
import {tmpdir} from 'os';
import GameService from '@/class/GameService.class';
import type MameService from '@/class/MameService.class';

// GameService used to read public/data/genre_206.ini and nplayers_206.ini through
// the ambient __static global. refacto-2026 replaced that entirely: genre.ini and
// Multiplayer.ini are now optional, per-mame-version files resolved through
// MameService.genreIniPath/nplayersIniPath (ui.ini's categorypath directory), and
// public/data/*.ini no longer exist in the repository at all. See
// GameService.class.ts's own comments on getGameCategories/getGameNplayers.
//
// So this file no longer touches __static, and instead fakes the one MameService
// surface these two methods actually read: the genreIniPath/nplayersIniPath
// getters. Neither method touches anything else on MameService or HiscoreService.

let dir: string;
let genreIniPath: string;
let nplayersIniPath: string;
let catverIniPath: string;

beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'mame-gameservice-ini-'));
    genreIniPath = join(dir, 'genre.ini');
    nplayersIniPath = join(dir, 'Multiplayer.ini');

    // The 'ini' package parses a bare key with no '=value' as boolean true, which
    // is the shape genre.ini/Multiplayer.ini actually use: one section per
    // category, one rom name per line under it.
    writeFileSync(genreIniPath, [
        '[Ball & Paddle]',
        'arkanoid',
        '[Board Game]',
        'academy',
        '',
    ].join('\n'));

    catverIniPath = join(dir, 'catver.ini');
    writeFileSync(catverIniPath, [
        '[Category]',
        'sf2=Fighter / Versus',
        'ffight=Fighter / 2.5D',
        'arkanoid=Ball & Paddle / Breakout',
        '',
    ].join('\n'));

    writeFileSync(nplayersIniPath, [
        '[2P alt]',
        'arkanoid',
        '',
    ].join('\n'));
});

afterAll(() => {
    rmSync(dir, {recursive: true, force: true});
});

afterEach(() => {
    // getGameCategories/getGameNplayers cache their parsed result on GameService's
    // own static fields, memoized on first read. Each describe block below needs a
    // fresh read (present-path tests must not see a null-path test's empty cache,
    // and vice versa), and GameService exposes no reset method for this, so the
    // cache is cleared directly. This is reflection into a protected static, done
    // only because the class does not offer another way to isolate tests here.
    (GameService as unknown as {genreIni?: unknown}).genreIni = undefined;
    (GameService as unknown as {nplayersIni?: unknown}).nplayersIni = undefined;
});

function serviceWithPaths(paths: {
    genreIniPath: string | null;
    nplayersIniPath: string | null;
    catverIniPath?: string | null;
}): GameService {
    const fakeMameService = paths as unknown as MameService;
    // Neither method under test touches HiscoreService.
    return new GameService(fakeMameService, null as never);
}

describe('GameService ini lookups, genre.ini and Multiplayer.ini present', () => {
    let service: GameService;

    beforeAll(() => {
        service = serviceWithPaths({genreIniPath, nplayersIniPath});
    });

    it('loads the genre file and exposes the categories', () => {
        const categories = service.getGameCategories();
        expect(Object.keys(categories)).toEqual(['Ball & Paddle', 'Board Game']);
    });

    it('returns a 1-based category id, counting sections in file order', () => {
        // arkanoid sits under [Ball & Paddle], the first section, so id 1.
        expect(service.getGameCategoryId('arkanoid')).toBe(1);
        // academy sits under [Board Game], the second section, so id 2.
        expect(service.getGameCategoryId('academy')).toBe(2);
    });

    it('returns undefined for a rom in no category', () => {
        expect(service.getGameCategoryId('definitely-not-a-real-rom')).toBeUndefined();
    });

    it('reads the player counts for a known rom', () => {
        // arkanoid sits under [2P alt], which nplayersTranslation maps to alt 2.
        expect(service.getGameNplayers('arkanoid')).toEqual({sim: 0, alt: 2});
    });

    it('falls back to zeroes for a rom absent from nplayers.ini', () => {
        // Note this is the same shape as the '1P' translation, so this assertion
        // cannot distinguish "not found" from "found and single-player".
        expect(service.getGameNplayers('definitely-not-a-real-rom')).toEqual({sim: 0, alt: 0});
    });
});

describe('GameService ini lookups, genre.ini and Multiplayer.ini absent', () => {
    // MameService.genreIniPath/nplayersIniPath are null until a starting pack
    // import installs the files (see MameService.class.ts). GameService must not
    // throw in that case: it falls back to an empty dataset, which is how the UI
    // shows a flat game list instead of failing (see GameService.class.ts's
    // comments and Home.vue).
    let service: GameService;

    beforeAll(() => {
        service = serviceWithPaths({genreIniPath: null, nplayersIniPath: null});
    });

    it('returns an empty category set instead of throwing', () => {
        expect(service.getGameCategories()).toEqual({});
    });

    it('returns undefined for any rom, category id included', () => {
        expect(service.getGameCategoryId('arkanoid')).toBeUndefined();
    });

    it('returns zeroes for any rom, player count included', () => {
        expect(service.getGameNplayers('arkanoid')).toEqual({sim: 0, alt: 0});
    });
});

describe('GameService ini lookups, catver.ini present next to genre.ini', () => {
    // catver.ini (MameService.catverIniPath) takes precedence over genre.ini: same genres, but
    // split by subgenre into MAUI genres (see CatverGenres.ts).
    let service: GameService;

    beforeAll(() => {
        service = serviceWithPaths({genreIniPath, nplayersIniPath, catverIniPath});
    });

    it('exposes the MAUI genres, sorted by name, instead of genre.ini\'s', () => {
        expect(Object.keys(service.getGameCategories())).toEqual(['Ball & Paddle', 'Beat \'em Up', 'Fighting']);
    });

    it('files a versus fighter and a beat \'em up under different categories', () => {
        expect(service.getGameCategoryId('arkanoid')).toBe(1);
        expect(service.getGameCategoryId('ffight')).toBe(2);
        expect(service.getGameCategoryId('sf2')).toBe(3);
    });

    it('no longer reads genre.ini for categories', () => {
        // academy is only in genre.ini.
        expect(service.getGameCategoryId('academy')).toBeUndefined();
    });
});
