import {describe, it, expect, vi, afterEach} from 'vitest';
import {mkdtempSync, rmSync} from 'fs';
import {tmpdir} from 'os';
import {join} from 'path';
import HiscoreService from '@/class/HiscoreService.class';
import type UserService from '@/class/UserService.class';
import type Game from '@/model/Game.model';

const logError = vi.hoisted(() => vi.fn());
vi.mock('electron-log', () => ({error: logError, debug: vi.fn(), warn: vi.fn(), info: vi.fn()}));

// saveHiscores() runs at startup on every favorite (Init.vue), most of which mhiex has no
// extractor for (issue #100).

const userService = {
    loadUsers: () => Promise.resolve(),
    getScorer: () => undefined,
} as unknown as UserService;

const game = (romName: string) => ({id_game: 1, romName}) as unknown as Game;

describe('HiscoreService.saveHiscores', () => {
    const dirs: string[] = [];

    afterEach(() => {
        logError.mockReset();
        dirs.splice(0).forEach(dir => rmSync(dir, {recursive: true, force: true}));
    });

    it('skips, without an error, the games mhiex has no extractor for', async () => {
        const mameHome = mkdtempSync(join(tmpdir(), 'maui-hiscores-'));
        dirs.push(mameHome);
        // puckman: no extractor; dkong: an extractor, but no .hi written yet.
        await new HiscoreService(mameHome, userService).saveHiscores([game('puckman'), game('dkong')]);

        expect(logError).not.toHaveBeenCalled();
    });
});
