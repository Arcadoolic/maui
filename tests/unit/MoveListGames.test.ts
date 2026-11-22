import {afterEach, beforeEach, describe, expect, it} from 'vitest';
import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'fs';
import {tmpdir} from 'os';
import {join} from 'path';
import {loadMoveListGames} from '@/class/MoveListGames';

describe('loadMoveListGames', () => {
    let home: string;

    beforeEach(() => {
        home = mkdtempSync(join(tmpdir(), 'maui-movelist-'));
    });

    afterEach(() => rmSync(home, {recursive: true, force: true}));

    it('names the games the installed movelist plugin has a base for', () => {
        const dir = join(home, 'maui-plugins', 'movelist', 'games');
        mkdirSync(dir, {recursive: true});
        ['mk.json', 'sf2ce.json', 'notes.txt', 'mk2.json.bak-20261122'].forEach(name => writeFileSync(join(dir, name), '{}'));
        expect([...loadMoveListGames(home)].sort()).toEqual(['mk', 'sf2ce']);
    });

    it('knows none before the plugin is installed', () => {
        expect(loadMoveListGames(home).size).toBe(0);
    });
});
