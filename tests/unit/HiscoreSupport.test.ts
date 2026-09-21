import {describe, it, expect} from 'vitest';
import {hasHiscoreExtraction} from '@/class/HiscoreSupport';

describe('hasHiscoreExtraction', () => {
    it('is true for a rom mhiex has an extractor for', () => {
        expect(hasHiscoreExtraction('raiden')).toBe(true);
        expect(hasHiscoreExtraction('dkong')).toBe(true);
    });

    it('is false for a rom without one', () => {
        expect(hasHiscoreExtraction('not-a-mame-rom')).toBe(false);
    });

    it('does not cover a clone that has no extractor of its own', () => {
        expect(hasHiscoreExtraction('raidenj')).toBe(false);
    });
});
