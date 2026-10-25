import {describe, it, expect, beforeEach, afterEach, vi} from 'vitest';
import {mkdtempSync, rmSync, writeFileSync, readFileSync} from 'fs';
import {join} from 'path';
import {tmpdir} from 'os';
import {parseFavorites} from '@/class/MameIniParser';
import {
    removeFavoriteFromDisk, removeReturnedFavorites, readRemovedFavorites, readFavoritesCache,
    mergeFavoritesCache,
} from '@/class/FavoritesStore';

// FavoritesStore keeps its files in os.homedir()/.mame-awesome-ui, like Config.class.ts: stub the
// home directory (see Config.class.test.ts for why 'node:os' is the spelling Vitest intercepts).
const homedirOverride: {value: string | null} = {value: null};

vi.mock('node:os', async (importOriginal) => {
    const actual = await importOriginal<typeof import('os')>();
    return {
        ...actual,
        homedir: () => homedirOverride.value ?? actual.homedir(),
    };
});

const entry = (rom: string, name: string) => [
    rom, name, '', '', '', '0', '', rom, '', '', '', '1', '', '', '', '1',
].join('\n') + '\n';
const header = '﻿[ROOT_FOLDER]\n[Favorite]\n\n';
const favorites = header + entry('galaga', 'Galaga') + entry('hasamu', 'Hasamu (Japan)') + entry('pacman', 'Pac-Man');

let fakeHome: string;
let favoritesPath: string;

beforeEach(() => {
    fakeHome = mkdtempSync(join(tmpdir(), 'mame-returned-home-'));
    homedirOverride.value = fakeHome;
    favoritesPath = join(fakeHome, 'favorites.ini');
    writeFileSync(favoritesPath, favorites);
});

afterEach(() => {
    homedirOverride.value = null;
    rmSync(fakeHome, {recursive: true, force: true});
});

describe('removeReturnedFavorites', () => {
    it('leaves favorites.ini untouched when nothing was removed', () => {
        expect(removeReturnedFavorites(favoritesPath)).toEqual([]);
        expect(readFileSync(favoritesPath, 'utf8')).toBe(favorites);
    });

    it('leaves favorites.ini untouched when the removed games did not come back', () => {
        removeFavoriteFromDisk(favoritesPath, 'hasamu');
        const afterRemoval = readFileSync(favoritesPath, 'utf8');

        expect(removeReturnedFavorites(favoritesPath)).toEqual([]);
        expect(readFileSync(favoritesPath, 'utf8')).toBe(afterRemoval);
    });

    it('takes out again the removed games put back in favorites.ini', () => {
        removeFavoriteFromDisk(favoritesPath, 'hasamu');
        removeFavoriteFromDisk(favoritesPath, 'pacman');
        const record = readRemovedFavorites().find(item => item.romName === 'hasamu');
        // What a pack import did before it skipped the removed games.
        writeFileSync(favoritesPath, favorites);
        mergeFavoritesCache({
            galaga: {fullname: 'Galaga', biosName: null, deviceRoms: []},
            hasamu: {fullname: 'Hasamu (Japan)', biosName: null, deviceRoms: []},
        });

        expect(removeReturnedFavorites(favoritesPath)).toEqual(['hasamu', 'pacman']);
        expect(parseFavorites(readFileSync(favoritesPath, 'utf8'))).toEqual(['galaga']);
        expect(readFileSync(favoritesPath, 'utf8')).toBe(header + entry('galaga', 'Galaga'));
        // Still restorable from the BO, with the record of the first removal.
        expect(readRemovedFavorites().find(item => item.romName === 'hasamu')).toEqual(record);
        expect(Object.keys(readFavoritesCache()?.entries ?? {})).toEqual(['galaga']);
    });

    it('adds entries to the cache and keeps its MAME version until all are resolved again', () => {
        mergeFavoritesCache({galaga: {fullname: 'Galaga', biosName: null, deviceRoms: []}}, '0.280');
        mergeFavoritesCache({pacman: {fullname: 'Pac-Man', biosName: 'puckman', deviceRoms: []}});

        expect(readFavoritesCache()).toMatchObject({mameVersion: '0.280', entries: {
            galaga: {fullname: 'Galaga'}, pacman: {fullname: 'Pac-Man', biosName: 'puckman'},
        }});
        expect(mergeFavoritesCache({}, '0.281').mameVersion).toBe('0.281');
    });
});
