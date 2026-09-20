import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import Game from '@/model/Game.model';
import GameService from '@/class/GameService.class';
import type MameService from '@/class/MameService.class';
import type HiscoreService from '@/class/HiscoreService.class';

// Game is paranoid: a game dropped from favorites.ini is only soft-deleted (romName is unique, so
// its row stays). Putting it back in favorites.ini used to leave it hidden: findAll() can't see
// the soft-deleted row, so the game took the "new game" path, and bulkCreate's updateOnDuplicate
// refreshed its columns but never touched deletedAt. Game is an empty stand-in here (see
// tests/stubs/game-model.ts: Vitest's esbuild doesn't emit the decorator metadata
// sequelize-typescript needs, so no real SQLite), so this asserts the calls made on it, the way
// UserService.test.ts does for User.

const mameService = {
    genreIniPath: undefined,
    nplayersIniPath: undefined,
    getGameInformation: () => ({description: 'Donkey Kong (US set 1)', manufacturer: 'Nintendo', year: '1981'}),
} as unknown as MameService;
const hiService = {hasHiscore: () => false} as unknown as HiscoreService;

type GameStatics = {[method: string]: (...args: unknown[]) => Promise<unknown>};

describe('GameService.saveGamesFromRomNames', () => {
    const statics = Game as unknown as GameStatics;
    const calls: string[] = [];
    let restoreArgs: unknown[] = [];

    beforeEach(() => {
        calls.length = 0;
        statics.restore = (...args) => { calls.push('restore'); restoreArgs = args; return Promise.resolve(0); };
        statics.findAll = () => { calls.push('findAll'); return Promise.resolve([]); };
        statics.destroy = () => Promise.resolve(0);
        statics.bulkCreate = () => { calls.push('bulkCreate'); return Promise.resolve([]); };
    });

    afterEach(() => {
        for (const method of ['restore', 'findAll', 'destroy', 'bulkCreate']) {
            delete statics[method];
        }
    });

    it('restores the soft-deleted games now in favorites before looking up existing ones', async () => {
        const service = new GameService(mameService, hiService);

        await service.saveGamesFromRomNames(['dkong', 'mario']);

        expect(restoreArgs).toEqual([{where: {romName: ['dkong', 'mario']}}]);
        expect(calls).toEqual(['restore', 'findAll', 'bulkCreate']);
    });
});
