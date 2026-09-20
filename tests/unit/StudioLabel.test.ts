import {describe, it, expect} from 'vitest';
import {studioInParentheses} from '@/class/StudioLabel';

describe('studioInParentheses', () => {
    it('turns the license note into a comma-separated part', () => {
        expect(studioInParentheses('NMK (Jaleco license)')).toBe('NMK, Jaleco license');
        expect(studioInParentheses('Irem (licensed from Hudson Soft)')).toBe('Irem, licensed from Hudson Soft');
        expect(studioInParentheses('Data East Corporation (licensed from First Star)'))
            .toBe('Data East Corporation, licensed from First Star');
    });

    it('leaves a studio without a note untouched', () => {
        expect(studioInParentheses('Capcom')).toBe('Capcom');
        expect(studioInParentheses('Jaleco / NMK')).toBe('Jaleco / NMK');
        expect(studioInParentheses('')).toBe('');
    });
});
