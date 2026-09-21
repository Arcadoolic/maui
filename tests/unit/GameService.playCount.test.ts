import {describe, it, expect, afterEach} from 'vitest';
import {createRequire} from 'module';
import Game from '@/model/Game.model';
import GameService from '@/class/GameService.class';
import type MameService from '@/class/MameService.class';
import type HiscoreService from '@/class/HiscoreService.class';

// Game is an empty stand-in here (see tests/stubs/game-model.ts), so this asserts the call made on
// it, the way GameService.softDelete.test.ts does.

type GameStatics = {[method: string]: (...args: unknown[]) => Promise<unknown>};

describe('GameService.recordLaunch', () => {
    const statics = Game as unknown as GameStatics;

    afterEach(() => {
        delete statics.update;
    });

    it('atomically counts one more play of the launched rom only, and dates it', async () => {
        let args: unknown[] = [];
        statics.update = (...a) => { args = a; return Promise.resolve([1]); };
        const service = new GameService({} as MameService, {} as HiscoreService);
        const before = Date.now();

        await service.recordLaunch('dkong');

        const [values, options] = args as [{play_count: {val: string}, last_played_at: Date}, unknown];
        expect(values.play_count.val).toBe('play_count + 1');
        expect(values.last_played_at.getTime()).toBeGreaterThanOrEqual(before);
        expect(options).toEqual({where: {romName: 'dkong'}});
    });
});

// The migrations are shipped as plain CommonJS and run on every start (Database.update()): they
// must add the columns to a database created by an older version, but leave a fresh install alone,
// where sequelize.sync() already created them from the model.
describe.each([
    {
        file: '20260921090000-game-play-count.js',
        column: 'play_count',
        expected: [['game', 'play_count', {type: 'INTEGER', allowNull: false, defaultValue: 0}]],
    },
    {
        file: '20260921100000-game-vote-last-played.js',
        column: 'vote',
        expected: [
            ['game', 'vote', {type: 'INTEGER', allowNull: false, defaultValue: 0}],
            ['game', 'last_played_at', {type: 'DATE', allowNull: true}],
        ],
    },
])('$file migration', ({file, column, expected}) => {
    const migration = createRequire(import.meta.url)('../../migrations/' + file);
    const Sequelize = {INTEGER: 'INTEGER', DATE: 'DATE'};

    const fakeQueryInterface = (columns: Record<string, unknown>) => {
        const added: unknown[][] = [];
        return {
            added,
            describeTable: () => Promise.resolve(columns),
            addColumn: (...a: unknown[]) => { added.push(a); return Promise.resolve(); },
        };
    };

    it('adds the missing columns to a game table that lacks them', async () => {
        const qi = fakeQueryInterface({id_game: {}});

        await migration.up(qi, Sequelize);

        expect(qi.added).toEqual(expected);
    });

    it('does nothing when the columns already exist', async () => {
        const qi = fakeQueryInterface({id_game: {}, play_count: {}, vote: {}, last_played_at: {}});

        await migration.up(qi, Sequelize);

        expect(qi.added).toEqual([]);
    });

    it('only adds what is missing', async () => {
        const qi = fakeQueryInterface({id_game: {}, play_count: {}, [column]: {}});

        await migration.up(qi, Sequelize);

        expect(qi.added.map(call => call[1])).not.toContain(column);
    });
});
