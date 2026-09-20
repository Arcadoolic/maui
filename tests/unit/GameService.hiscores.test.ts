import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import Game from '@/model/Game.model';
import GameService from '@/class/GameService.class';
import type MameService from '@/class/MameService.class';
import type HiscoreService from '@/class/HiscoreService.class';
import {HISCORES_ONLY_CATEGORY, isDynamicCategory} from '@/types/CarouselCategory';

// Game is an empty stand-in here (see tests/stubs/game-model.ts), so this asserts the query made
// on it, the way GameService.softDelete.test.ts does.

const mameService = {} as unknown as MameService;
const hiService = {} as unknown as HiscoreService;

type GameStatics = {[method: string]: (...args: unknown[]) => Promise<unknown>};

describe('GameService.loadHiscoreGames', () => {
    const statics = Game as unknown as GameStatics;
    let findAllArgs: unknown[] = [];

    beforeEach(() => {
        statics.findAll = (...args) => { findAllArgs = args; return Promise.resolve([]); };
    });

    afterEach(() => {
        delete statics.findAll;
    });

    it('asks for the games with extractable hiscores, in the same order as "All games"', async () => {
        const service = new GameService(mameService, hiService);

        await service.loadHiscoreGames();

        expect(findAllArgs).toEqual([{where: {hi: true}, order: ['romName']}]);
    });

    it('is queried every time: a game gaining hiscore support shows up without a restart', async () => {
        const service = new GameService(mameService, hiService);
        let calls = 0;
        statics.findAll = () => { calls++; return Promise.resolve([]); };

        await service.loadHiscoreGames();
        await service.loadHiscoreGames();

        expect(calls).toBe(2);
    });
});

describe('dynamic carousel category', () => {
    it('is told apart from a stored category', () => {
        expect(isDynamicCategory(HISCORES_ONLY_CATEGORY)).toBe(true);
        expect(isDynamicCategory({id_category: 3, name: 'Shooter'} as never)).toBe(false);
    });

    it('cannot clash with an autoincrement category id', () => {
        expect(HISCORES_ONLY_CATEGORY.id_category).toBeLessThan(0);
    });
});
