import {describe, it, expect} from 'vitest';
import {parseMameIni, parseFavorites, removeFavorite, addFavorite} from '@/class/MameIniParser';

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

describe('removeFavorite', () => {
    const entryLines = (rom: string, name: string) => [
        rom, name, '', '', '', '0', '', rom, '', '', '', '1', '', '', '', '1',
    ];
    const entry = (rom: string, name: string) => entryLines(rom, name).join('\n') + '\n';
    const header = '\ufeff[ROOT_FOLDER]\n[Favorite]\n\n';

    it('removes only the requested entry, keeping the header and the other entries', () => {
        const content = header + entry('asteroid', 'Asteroids') + entry('bzone', 'Battlezone')
            + entry('pacman', 'Pac-Man');
        expect(removeFavorite(content, 'bzone')?.content)
            .toBe(header + entry('asteroid', 'Asteroids') + entry('pacman', 'Pac-Man'));
    });

    it('returns the removed block, without trailing newline', () => {
        const content = header + entry('asteroid', 'Asteroids') + entry('bzone', 'Battlezone');
        expect(removeFavorite(content, 'bzone')?.entry).toBe(entryLines('bzone', 'Battlezone').join('\n'));
    });

    it('removes the first and the last entries too', () => {
        const content = header + entry('asteroid', 'Asteroids') + entry('bzone', 'Battlezone');
        expect(removeFavorite(content, 'asteroid')?.content).toBe(header + entry('bzone', 'Battlezone'));
        expect(removeFavorite(content, 'bzone')?.content).toBe(header + entry('asteroid', 'Asteroids'));
    });

    it('keeps CRLF line endings intact, and returns the block with plain newlines', () => {
        const content = (header + entry('asteroid', 'Asteroids') + entry('bzone', 'Battlezone'))
            .replace(/\n/g, '\r\n');
        const removed = removeFavorite(content, 'asteroid');
        expect(removed?.content).toBe((header + entry('bzone', 'Battlezone')).replace(/\n/g, '\r\n'));
        expect(removed?.entry).toBe(entryLines('asteroid', 'Asteroids').join('\n'));
    });

    it('does not match a rom name appearing inside another entry or as a prefix', () => {
        const content = header + entry('pacman', 'Pac-Man') + entry('pacmanf', 'Pac-Man (fast)');
        expect(removeFavorite(content, 'pacman')?.content).toBe(header + entry('pacmanf', 'Pac-Man (fast)'));
    });

    it('returns null when the rom is not in the file', () => {
        expect(removeFavorite(header + entry('asteroid', 'Asteroids'), 'bzone')).toBeNull();
    });

    it('returns null when the entry does not have the expected layout', () => {
        expect(removeFavorite(header + 'asteroid\nAsteroids\n', 'asteroid')).toBeNull();
        const truncated = header + entry('asteroid', 'Asteroids').split('\n').slice(0, 12).join('\n');
        expect(removeFavorite(truncated, 'asteroid')).toBeNull();
    });
});

describe('addFavorite', () => {
    const entryLines = (rom: string, name: string) => [
        rom, name, '', '', '', '0', '', rom, '', '', '', '1', '', '', '', '1',
    ];
    const entry = (rom: string, name: string) => entryLines(rom, name).join('\n') + '\n';
    const header = '\ufeff[ROOT_FOLDER]\n[Favorite]\n\n';
    const block = entryLines('bzone', 'Battlezone').join('\n');

    it('appends the entry after the existing ones', () => {
        expect(addFavorite(header + entry('asteroid', 'Asteroids'), block))
            .toBe(header + entry('asteroid', 'Asteroids') + entry('bzone', 'Battlezone'));
    });

    it('puts back exactly what removeFavorite() took out', () => {
        const content = header + entry('asteroid', 'Asteroids') + entry('bzone', 'Battlezone');
        const removed = removeFavorite(content, 'bzone');
        expect(addFavorite(removed!.content, removed!.entry)).toBe(content);
    });

    it('uses CRLF when the file does', () => {
        const content = (header + entry('asteroid', 'Asteroids')).replace(/\n/g, '\r\n');
        expect(addFavorite(content, block))
            .toBe((header + entry('asteroid', 'Asteroids') + entry('bzone', 'Battlezone')).replace(/\n/g, '\r\n'));
    });

    it('terminates a last line that has no newline before appending', () => {
        const content = header + entry('asteroid', 'Asteroids').trimEnd();
        expect(addFavorite(content, block)).toBe(header + entry('asteroid', 'Asteroids') + entry('bzone', 'Battlezone'));
    });

    it('starts a header on an empty file', () => {
        expect(addFavorite('', block)).toBe(header + entry('bzone', 'Battlezone'));
    });

    it('returns null when the rom is already listed', () => {
        expect(addFavorite(header + entry('bzone', 'Battlezone'), block)).toBeNull();
    });

    it('returns null for an invalid entry', () => {
        expect(addFavorite(header, 'bzone\nBattlezone')).toBeNull();
        expect(addFavorite(header, block.replace('bzone', 'BZONE'))).toBeNull();
    });
});

describe('addFavorite ordering', () => {
    const entryLines = (rom: string, name: string) => [
        rom, name, '', '', '', '0', '', rom, '', '', '', '1', '', '', '', '1',
    ];
    const entry = (rom: string, name: string) => entryLines(rom, name).join('\n') + '\n';
    const header = '﻿[ROOT_FOLDER]\n[Favorite]\n\n';
    const list = (...games: [string, string][]) => header + games.map(([rom, name]) => entry(rom, name)).join('');
    const block = (rom: string, name: string) => entryLines(rom, name).join('\n');

    it('inserts in alphabetical position by game name, not at the end', () => {
        const content = list(['asteroid', 'Asteroids'], ['pong', 'Pong'], ['warlords', 'Warlords']);
        expect(addFavorite(content, block('paperboy', 'Paperboy (rev 3)'))).toBe(
            list(['asteroid', 'Asteroids'], ['paperboy', 'Paperboy (rev 3)'], ['pong', 'Pong'], ['warlords', 'Warlords']),
        );
    });

    it('compares game names, not rom names', () => {
        // centiped comes before ccastles by name (Centipede < Crystal Castles), the reverse of the rom names
        const content = list(['centiped', 'Centipede'], ['warlords', 'Warlords']);
        expect(addFavorite(content, block('ccastles', 'Crystal Castles')))
            .toBe(list(['centiped', 'Centipede'], ['ccastles', 'Crystal Castles'], ['warlords', 'Warlords']));
    });

    it('ignores case and puts an entry that sorts first at the top, after the header', () => {
        const content = list(['bzone', 'Battlezone'], ['pong', 'Pong']);
        expect(addFavorite(content, block('aburner', 'after Burner')))
            .toBe(list(['aburner', 'after Burner'], ['bzone', 'Battlezone'], ['pong', 'Pong']));
    });

    it('sorts punctuation before letters, like the packs do', () => {
        const content = list(['starwars', 'Star Wars'], ['tempest', 'Tempest']);
        expect(addFavorite(content, block('stunrun', 'S.T.U.N. Runner (rev 6)')))
            .toBe(list(['stunrun', 'S.T.U.N. Runner (rev 6)'], ['starwars', 'Star Wars'], ['tempest', 'Tempest']));
    });

    it('puts back a middle entry exactly where removeFavorite() took it from', () => {
        const content = list(['asteroid', 'Asteroids'], ['bzone', 'Battlezone'], ['pong', 'Pong']);
        const removed = removeFavorite(content, 'bzone')!;
        expect(addFavorite(removed.content, removed.entry)).toBe(content);
    });

    it('keeps CRLF line endings when inserting in the middle', () => {
        const content = list(['asteroid', 'Asteroids'], ['pong', 'Pong']).replace(/\n/g, '\r\n');
        expect(addFavorite(content, block('bzone', 'Battlezone')))
            .toBe(list(['asteroid', 'Asteroids'], ['bzone', 'Battlezone'], ['pong', 'Pong']).replace(/\n/g, '\r\n'));
    });

    it('inserts before the first entry that sorts after it when the list is not sorted', () => {
        const content = list(['pong', 'Pong'], ['asteroid', 'Asteroids'], ['warlords', 'Warlords']);
        expect(addFavorite(content, block('bzone', 'Battlezone')))
            .toBe(list(['bzone', 'Battlezone'], ['pong', 'Pong'], ['asteroid', 'Asteroids'], ['warlords', 'Warlords']));
    });
});
