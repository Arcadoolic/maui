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

// Three times the same letter (AAA, ZZZ...): refused for new players, the BO and the front alike,
// as MAUI-API does (maui-api app/Support/Pseudo3.php). Existing players keep theirs.
const SAME_LETTER_PATTERN = /^(.)\1\1$/;

export const NEW_PSEUDO3_RULE = 'The nickname cannot be the same letter three times.';

/** Why these initials cannot be given to a new player, or null when they can. */
export function newPseudo3Error(pseudo3: string): string | null {
    if (!isValidPseudo3(pseudo3)) {
        return PSEUDO3_RULE;
    }
    return SAME_LETTER_PATTERN.test(pseudo3) ? NEW_PSEUDO3_RULE : null;
}
