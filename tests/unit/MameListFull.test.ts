import {describe, it, expect} from 'vitest';
import {parseListFull} from '@/class/MameListFull';

describe('parseListFull', () => {
    it('maps rom names to their description, skipping the header and unknown names', () => {
        const stdout = [
            'Name:             Description:',
            '1942              "1942 (Revision B)"',
            'pacman            "Pac-Man (Midway)"',
            'No matching systems found for \'zzzz\'',
            '',
        ].join('\n');
        expect([...parseListFull(stdout)]).toEqual([['1942', '1942 (Revision B)'], ['pacman', 'Pac-Man (Midway)']]);
    });

    it('keeps quotes inside a description', () => {
        expect(parseListFull('ghouls   "Ghouls \'n Ghosts "World" (set 1)"\n').get('ghouls'))
            .toBe('Ghouls \'n Ghosts "World" (set 1)');
    });

    it('returns an empty map for empty output', () => {
        expect(parseListFull('').size).toBe(0);
    });
});
