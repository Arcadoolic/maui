import {describe, it, expect} from 'vitest';
import {CONF_PACK_FILENAME, confPackVersion, getMissingConfPackFiles, isGamePack} from '@/class/ConfPack';

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

describe('confPackVersion', () => {
    it('is the zip\'s size and date', () => {
        expect(confPackVersion({zip: {size: 861681, mtime: 1790575408}, files: []})).toBe('861681:1790575408');
    });

    it('is unknown when the companion does not say', () => {
        expect(confPackVersion(null)).toBeNull();
        expect(confPackVersion({files: []})).toBeNull();
        expect(confPackVersion({zip: {size: '861681', mtime: 1}})).toBeNull();
    });
});
