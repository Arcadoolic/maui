import {describe, it, expect, beforeEach, afterEach, vi} from 'vitest';
import {mkdtempSync, rmSync, writeFileSync, readFileSync, mkdirSync} from 'fs';
import {join} from 'path';
import {tmpdir} from 'os';
import Game from '@/model/Game.model';
import GameService from '@/class/GameService.class';
import {parseFavorites} from '@/class/MameIniParser';
import {readRemovedFavorites, readFavoritesCache} from '@/class/FavoritesStore';
import {VOTE_DOWN, VOTE_UP} from '@/class/GameVote';
import type MameService from '@/class/MameService.class';
import type HiscoreService from '@/class/HiscoreService.class';

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

// Game is an empty stand-in here (see tests/stubs/game-model.ts): the calls made on it are
// asserted, the way GameService.softDelete.test.ts does.
type GameStatics = {[method: string]: (...args: unknown[]) => Promise<unknown>};
const statics = Game as unknown as GameStatics;

const entryLines = (rom: string, name: string) => [
    rom, name, '', '', '', '0', '', rom, '', '', '', '1', '', '', '', '1',
];
const entry = (rom: string, name: string) => entryLines(rom, name).join('\n') + '\n';
const header = '﻿[ROOT_FOLDER]\n[Favorite]\n\n';

let fakeHome: string;
let favoritesPath: string;
let updates: unknown[][];
let synced: string[][];
let service: GameService;

function makeService(favorites: string | null) {
    favoritesPath = join(fakeHome, 'favorites.ini');
    if (favorites !== null) {
        writeFileSync(favoritesPath, favorites);
    }
    const mameService = {
        get favoritesPath() { return favorites === null ? null : favoritesPath; },
        getRomListFromFavorites: () => parseFavorites(readFileSync(favoritesPath, 'utf8')),
    } as unknown as MameService;
    service = new GameService(mameService, {} as HiscoreService);
    service.saveGamesFromRomNames = (romNames: string[]) => { synced.push(romNames); return Promise.resolve(); };
}

beforeEach(() => {
    fakeHome = mkdtempSync(join(tmpdir(), 'mame-vote-home-'));
    homedirOverride.value = fakeHome;
    updates = [];
    synced = [];
    statics.update = (...args) => { updates.push(args); return Promise.resolve([1]); };
});

afterEach(() => {
    homedirOverride.value = null;
    rmSync(fakeHome, {recursive: true, force: true});
    delete statics.update;
    delete statics.findOne;
});

describe('GameService.applyVote', () => {
    const game = () => ({romName: 'bzone', vote: 0}) as unknown as Game;
    const twoFavorites = header + entry('asteroid', 'Asteroids') + entry('bzone', 'Battlezone');

    it('saves a thumbs up and leaves the favorites alone', async () => {
        makeService(twoFavorites);
        const voted = game();

        const removed = await service.applyVote(voted, VOTE_UP, true);

        expect(removed).toBe(false);
        expect(updates).toEqual([[{vote: VOTE_UP}, {where: {romName: 'bzone'}}]]);
        expect(voted.vote).toBe(VOTE_UP);
        expect(readFileSync(favoritesPath, 'utf8')).toBe(twoFavorites);
        expect(synced).toEqual([]);
    });

    it('keeps the game in the favorites on a thumbs down when the BO option is off', async () => {
        makeService(twoFavorites);

        const removed = await service.applyVote(game(), VOTE_DOWN, false);

        expect(removed).toBe(false);
        expect(updates).toEqual([[{vote: VOTE_DOWN}, {where: {romName: 'bzone'}}]]);
        expect(readFileSync(favoritesPath, 'utf8')).toBe(twoFavorites);
        expect(synced).toEqual([]);
    });

    it('takes the game out of favorites.ini on a thumbs down, keeps it restorable and resyncs', async () => {
        makeService(twoFavorites);
        mkdirSync(join(fakeHome, '.mame-awesome-ui'));
        writeFileSync(join(fakeHome, '.mame-awesome-ui', 'favorites-cache.json'), JSON.stringify({
            updatedAt: '2026-09-21T10:00:00.000Z',
            entries: {
                asteroid: {fullname: 'Asteroids', biosName: null, deviceRoms: []},
                bzone: {fullname: 'Battlezone', biosName: null, deviceRoms: []},
            },
        }));

        const removed = await service.applyVote(game(), VOTE_DOWN, true);

        expect(removed).toBe(true);
        expect(readFileSync(favoritesPath, 'utf8')).toBe(header + entry('asteroid', 'Asteroids'));
        // Same record the BO's "Removed" subtab lists and restores from.
        const [record] = readRemovedFavorites();
        expect(record).toMatchObject({romName: 'bzone', fullname: 'Battlezone', entry: entryLines('bzone', 'Battlezone').join('\n')});
        expect(readFavoritesCache()?.entries).not.toHaveProperty('bzone');
        expect(readFavoritesCache()?.entries).toHaveProperty('asteroid');
        // The games table follows favorites.ini (soft-deleting the removed one).
        expect(synced).toEqual([['asteroid']]);
    });

    it('still saves the vote, but reports no removal, when the game is not in favorites.ini', async () => {
        makeService(header + entry('asteroid', 'Asteroids'));

        const removed = await service.applyVote(game(), VOTE_DOWN, true);

        expect(removed).toBe(false);
        expect(updates).toHaveLength(1);
        expect(synced).toEqual([]);
    });

    it('does not fail when there is no favorites.ini at all', async () => {
        makeService(null);

        expect(await service.applyVote(game(), VOTE_DOWN, true)).toBe(false);
        expect(synced).toEqual([]);
    });
});

describe('GameService.loadLastPlayedGame', () => {
    it('asks for the most recently launched game still in the favorites', async () => {
        makeService(null);
        let args: unknown[] = [];
        const found = {romName: 'dkong'};
        statics.findOne = (...a) => { args = a; return Promise.resolve(found); };

        expect(await service.loadLastPlayedGame()).toBe(found);
        const [options] = args as [{where: {val: string}, order: unknown}];
        expect(options.where.val).toBe('last_played_at IS NOT NULL');
        expect(options.order).toEqual([['last_played_at', 'DESC']]);
    });
});
