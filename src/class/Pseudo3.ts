/**
 * A player's nickname (pseudo_3): 3 letters, A to Z - the letters the front's picker offers
 * (userRegistration.vue), which the BO must match. Scores are attributed by the name typed in the
 * game (scorePseudo3()), and only A-Z are sure to be offered by every game's name entry.
 */
export const PSEUDO3_PATTERN = /^[A-Z]{3}$/;

export const PSEUDO3_RULE = 'The nickname must be 3 letters, A to Z.';

export function isValidPseudo3(pseudo3: string): boolean {
    return PSEUDO3_PATTERN.test(pseudo3);
}
