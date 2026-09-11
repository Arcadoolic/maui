import {describe, it, expect} from 'vitest';
import {parseMameIni} from '@/class/MameIniParser';

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
