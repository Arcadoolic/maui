import {describe, it, expect} from 'vitest';
import {CONF_PACK_FILENAME, getMissingConfPackFiles, isGamePack} from '@/class/ConfPack';

describe('getMissingConfPackFiles', () => {
    it('lists nothing once the three files are installed', () => {
        expect(getMissingConfPackFiles({
            catverIniPath: '/mame/folders/catver.ini',
            genreIniPath: '/mame/folders/genre.ini',
            nplayersIniPath: '/mame/folders/Multiplayer.ini',
        })).toEqual([]);
    });

    it('names each missing file', () => {
        expect(getMissingConfPackFiles({
            catverIniPath: null,
            genreIniPath: '/mame/folders/genre.ini',
            nplayersIniPath: null,
        })).toEqual(['catver.ini', 'Multiplayer.ini']);
    });
});

describe('isGamePack', () => {
    it('keeps the configuration pack out of the game packs', () => {
        expect(isGamePack(CONF_PACK_FILENAME)).toBe(false);
        expect(isGamePack('capcom-pack.zip')).toBe(true);
    });
});
