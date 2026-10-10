import {describe, it, expect} from 'vitest';
import {getJumpIndex, getLetter, getLetters, OTHER_LETTER} from '@/class/AlphaJump';

// As GameService's GAMES_BY_TITLE orders them: by title, whatever its case, digits first.
const TITLES = ['005', '1942', 'Art of Fighting', 'Asteroids', 'Bubble Bobble', 'Donkey Kong', 'Donkey Kong Jr.',
    'Space Invaders', 'Zaxxon'];

describe('getLetter', () => {
    it('is the title\'s initial, in upper case', () => {
        expect(getLetter('Donkey Kong')).toBe('D');
        expect(getLetter('zaxxon')).toBe('Z');
    });

    it('files what does not start with a letter under one entry', () => {
        expect(getLetter('005')).toBe(OTHER_LETTER);
        expect(getLetter('1942')).toBe(OTHER_LETTER);
        expect(getLetter('\'88 Games')).toBe(OTHER_LETTER);
        expect(getLetter('')).toBe(OTHER_LETTER);
    });
});

describe('getLetters', () => {
    it('lists each initial once, in the order of the list', () => {
        expect(getLetters(TITLES)).toEqual(['#', 'A', 'B', 'D', 'S', 'Z']);
    });

    it('is empty for an empty list', () => {
        expect(getLetters([])).toEqual([]);
    });
});

describe('getJumpIndex', () => {
    it('goes to the first game of the next initial', () => {
        expect(getJumpIndex(TITLES, 0, false)).toBe(2);
        expect(getJumpIndex(TITLES, 3, false)).toBe(4);
        expect(getJumpIndex(TITLES, 6, false)).toBe(7);
    });

    it('goes to the first game of the previous initial, not of the current one', () => {
        expect(getJumpIndex(TITLES, 6, true)).toBe(4);
        expect(getJumpIndex(TITLES, 5, true)).toBe(4);
        expect(getJumpIndex(TITLES, 3, true)).toBe(0);
    });

    it('wraps around both ends', () => {
        expect(getJumpIndex(TITLES, 8, false)).toBe(0);
        expect(getJumpIndex(TITLES, 1, true)).toBe(8);
    });

    it('stays on the first game of a list with a single initial', () => {
        expect(getJumpIndex(['Donkey Kong', 'Donkey Kong 3', 'Donkey Kong Jr.'], 2, false)).toBe(0);
        expect(getJumpIndex(['Donkey Kong', 'Donkey Kong 3', 'Donkey Kong Jr.'], 2, true)).toBe(0);
    });

    it('answers 0 for an empty list', () => {
        expect(getJumpIndex([], 0, false)).toBe(0);
    });
});
