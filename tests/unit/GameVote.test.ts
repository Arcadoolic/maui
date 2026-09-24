import {describe, it, expect} from 'vitest';
import {parseVote, shouldAskVote, VOTE_DOWN, VOTE_NEUTRAL, VOTE_UP} from '@/class/GameVote';

describe('parseVote', () => {
    it('reads the three votes from numbers and form strings', () => {
        expect(parseVote(1)).toBe(VOTE_UP);
        expect(parseVote('1')).toBe(VOTE_UP);
        expect(parseVote('0')).toBe(VOTE_NEUTRAL);
        expect(parseVote('-1')).toBe(VOTE_DOWN);
    });

    it('rejects anything else, a missing field above all (it must not read as neutral)', () => {
        for (const value of [undefined, null, '', '  ', 'up', '2', -2, true, {}, []]) {
            expect(parseVote(value), String(value)).toBeNull();
        }
    });
});

describe('shouldAskVote', () => {
    it('asks while the game is neutral (also: never voted), whatever it was played before', () => {
        expect(shouldAskVote({vote: VOTE_NEUTRAL}, true)).toBe(true);
    });

    it('does not ask again once the game got a thumbs up or down', () => {
        expect(shouldAskVote({vote: VOTE_UP}, true)).toBe(false);
        expect(shouldAskVote({vote: VOTE_DOWN}, true)).toBe(false);
    });

    it('never asks when the BO turned the question off', () => {
        expect(shouldAskVote({vote: VOTE_NEUTRAL}, false)).toBe(false);
    });
});
