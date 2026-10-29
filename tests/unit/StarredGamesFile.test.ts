import {describe, it, expect} from 'vitest';
import {buildStarredFile, MAX_STARRED_GAMES, parseStarredFile, STARRED_FILE_FORMAT} from '@/class/StarredGamesFile';

describe('StarredGamesFile', () => {
    it('reads back the games it exported', () => {
        const file = buildStarredFile([
            {romName: 'dkong', name: 'Donkey Kong (US set 1)'},
            {romName: 'sf2', name: 'Street Fighter II'},
        ], new Date('2026-10-24T20:00:00Z'));

        expect(JSON.parse(file)).toMatchObject({format: STARRED_FILE_FORMAT, version: 1, exportedAt: '2026-10-24T20:00:00.000Z'});
        expect(parseStarredFile(file)).toEqual(['dkong', 'sf2']);
    });

    it('keeps each game once', () => {
        const file = JSON.stringify({format: STARRED_FILE_FORMAT, games: [{romName: 'sf2'}, {romName: 'sf2'}]});
        expect(parseStarredFile(file)).toEqual(['sf2']);
    });

    it('refuses what is not one of its files', () => {
        expect(() => parseStarredFile('not json')).toThrow('not JSON');
        expect(() => parseStarredFile('{"games": []}')).toThrow('not a "My favourites" export');
        expect(() => parseStarredFile(JSON.stringify({format: STARRED_FILE_FORMAT, games: {}}))).toThrow('not a "My favourites" export');
        expect(() => parseStarredFile('null')).toThrow('not a "My favourites" export');
    });

    it('refuses a rom name that is not one', () => {
        for (const romName of ['../etc/passwd', 'SF2', '', 42, null]) {
            const file = JSON.stringify({format: STARRED_FILE_FORMAT, games: [{romName}]});
            expect(() => parseStarredFile(file)).toThrow('valid rom name');
        }
    });

    it('refuses a file with too many games', () => {
        const games = Array.from({length: MAX_STARRED_GAMES + 1}, () => ({romName: 'sf2'}));
        expect(() => parseStarredFile(JSON.stringify({format: STARRED_FILE_FORMAT, games}))).toThrow('Too many games');
    });
});
