import {describe, it, expect} from 'vitest';
import {parseMameIni, parseFavorites} from '@/class/MameIniParser';

describe('parseMameIni', () => {
    it('reads a key and its value', () => {
        expect(parseMameIni('rompath roms')).toEqual({rompath: ['roms']});
    });

    it('splits every value on semicolons, because mame path settings are lists', () => {
        expect(parseMameIni('rompath roms;/opt/mame/roms')).toEqual({
            rompath: ['roms', '/opt/mame/roms'],
        });
    });

    it('returns a single value as a one-element array', () => {
        expect(parseMameIni('samplepath samples').samplepath).toEqual(['samples']);
    });

    it('strips one layer of surrounding double quotes', () => {
        expect(parseMameIni('rompath "/opt/my roms"')).toEqual({
            rompath: ['/opt/my roms'],
        });
    });

    it('skips comment lines', () => {
        const content = [
            '# this is a comment',
            'rompath roms',
        ].join('\n');
        expect(parseMameIni(content)).toEqual({rompath: ['roms']});
    });

    it('ignores keys that are not lowercase letters and underscores', () => {
        // The key pattern is /^([a-z_]+)\s+(.+)$/, so anything with a digit or an
        // uppercase letter in the key is dropped entirely.
        const content = [
            'rompath roms',
            'romPath2 other',
        ].join('\n');
        expect(parseMameIni(content)).toEqual({rompath: ['roms']});
    });

    it('ignores a key with no value', () => {
        expect(parseMameIni('rompath')).toEqual({});
    });

    it('trims each line before matching, so indented entries still parse', () => {
        expect(parseMameIni('    rompath roms   ')).toEqual({rompath: ['roms']});
    });

    it('keeps the last occurrence when a key is repeated', () => {
        const content = [
            'rompath first',
            'rompath second',
        ].join('\n');
        expect(parseMameIni(content)).toEqual({rompath: ['second']});
    });

    it('returns an empty object for empty input', () => {
        expect(parseMameIni('')).toEqual({});
    });
});

describe('parseFavorites', () => {
    it('extracts rom names from a realistic favorites.ini', () => {
        const content = [
            '[ROOT_FOLDER]',
            '[Favorite]',
            '',
            'pacman',
            '0',
            '0',
            '0',
            'galaga',
            '0',
            '0',
            '0',
            'dkong',
            '0',
            '0',
            '0',
        ].join('\n');

        expect(parseFavorites(content)).toEqual(['pacman', 'galaga', 'dkong']);
    });

    it('drops every other entry when matching lines are adjacent (known defect)', () => {
        // Deliberately locked in. The regex is built with the 'g' flag and reused
        // across .test() calls, so lastIndex survives a successful match and the
        // next line is tested from the wrong offset. See parseFavorites' comment.
        // Do not "fix" this test; fixing the parser is a separate change.
        const content = ['pacman', 'galaga', 'dkong', 'frogger', 'mspacman'].join('\n');

        expect(parseFavorites(content)).toEqual(['pacman', 'dkong', 'mspacman']);
    });

    it('ignores section headers', () => {
        expect(parseFavorites('[ROOT_FOLDER]\npacman')).toEqual(['pacman']);
    });

    it('ignores a bare single digit', () => {
        // The negative lookahead (?![0-9]$) exists to skip the metadata lines.
        expect(parseFavorites('0\npacman')).toEqual(['pacman']);
    });

    it('keeps a multi-digit line, which the lookahead does not cover', () => {
        expect(parseFavorites('[Favorite]\n1942')).toEqual(['1942']);
    });

    it('deduplicates', () => {
        const content = ['pacman', '0', 'pacman', '0', 'galaga'].join('\n');
        expect(parseFavorites(content)).toEqual(['pacman', 'galaga']);
    });

    it('returns an empty list for empty input', () => {
        expect(parseFavorites('')).toEqual([]);
    });
});
