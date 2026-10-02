import {describe, it, expect} from 'vitest';
import {NEW_PSEUDO3_RULE, PSEUDO3_RULE, isValidPseudo3, newPseudo3Error} from '@/class/Pseudo3';

// The BO's /users/create and the front's picker (userRegistration.vue) must accept the same
// nicknames. The rule is enforced by User.model's pseudo_3 validator (not loadable here).

describe('isValidPseudo3', () => {
    it('accepts 3 upper-case letters', () => {
        expect(isValidPseudo3('NOB')).toBe(true);
    });

    it.each(['A1B', 'A.B', 'AB', 'ABCD', 'nob', 'ÉAB', 'A B', ''])('refuses "%s"', pseudo3 => {
        expect(isValidPseudo3(pseudo3)).toBe(false);
    });
});

describe('newPseudo3Error', () => {
    it('accepts the initials of a new player', () => {
        expect(newPseudo3Error('NOB')).toBeNull();
        expect(newPseudo3Error('AAB')).toBeNull();
    });

    it.each(['AAA', 'ZZZ'])('refuses the same letter three times: "%s"', pseudo3 => {
        expect(newPseudo3Error(pseudo3)).toBe(NEW_PSEUDO3_RULE);
    });

    it('refuses what is not 3 letters', () => {
        expect(newPseudo3Error('A1B')).toBe(PSEUDO3_RULE);
    });

    it('still lets an existing player keep the same letter three times', () => {
        expect(isValidPseudo3('AAA')).toBe(true);
    });
});
