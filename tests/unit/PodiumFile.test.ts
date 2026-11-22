import {afterEach, beforeEach, describe, expect, it} from 'vitest';
import {existsSync, mkdtempSync, readFileSync, rmSync} from 'fs';
import {tmpdir} from 'os';
import {join} from 'path';
import {podiumFilePath, writePodiumFile} from '@/class/PodiumFile';

describe('writePodiumFile', () => {
    let home: string;

    beforeEach(() => {
        home = mkdtempSync(join(tmpdir(), 'maui-podium-'));
    });

    afterEach(() => rmSync(home, {recursive: true, force: true}));

    it('writes the best 3, best first, where the plugin reads them', () => {
        writePodiumFile(home, 'sf2ce', [
            {name: 'NOB', score: 1284500}, {name: 'RAF', score: 978200}, {name: 'AFR', score: 45100}, {name: 'ZZZ', score: 10},
        ]);
        expect(podiumFilePath(home, 'sf2ce')).toBe(join(home, 'maui-podium', 'sf2ce.json'));
        expect(JSON.parse(readFileSync(podiumFilePath(home, 'sf2ce'), 'utf8'))).toEqual({rows: [
            {name: 'NOB', score: 1284500}, {name: 'RAF', score: 978200}, {name: 'AFR', score: 45100},
        ]});
    });

    it('removes an older podium when the game has none', () => {
        writePodiumFile(home, 'sf2ce', [{name: 'NOB', score: 1}]);
        writePodiumFile(home, 'sf2ce', []);
        expect(existsSync(podiumFilePath(home, 'sf2ce'))).toBe(false);
    });

    it('writes nothing for a name that is not a rom name', () => {
        writePodiumFile(home, '../evil', [{name: 'NOB', score: 1}]);
        expect(existsSync(join(home, 'maui-podium'))).toBe(false);
    });
});
