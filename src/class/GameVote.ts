/**
 * The cabinet's vote on a game: asked once a game is quit (Home.vue), or set from the BO's Votes
 * tab. One vote per game, not per player.
 */
export const VOTE_DOWN = -1;
export const VOTE_NEUTRAL = 0;
export const VOTE_UP = 1;

export type Vote = typeof VOTE_DOWN | typeof VOTE_NEUTRAL | typeof VOTE_UP;

/** A vote from an untrusted value (BO form field, stored number), or null when it isn't one. */
export function parseVote(value: unknown): Vote | null {
    // Number('') is 0: a missing form field must not read as a neutral vote.
    if (typeof value !== 'number' && (typeof value !== 'string' || value.trim() === '')) {
        return null;
    }
    const vote = Number(value);
    return vote === VOTE_DOWN || vote === VOTE_NEUTRAL || vote === VOTE_UP ? vote : null;
}

/**
 * Whether the vote is asked after this game was quit: only while it is neutral, which is also
 * what a game nobody voted on yet is - a thumbs up or down is final until changed from the BO.
 */
export function shouldAskVote(game: {vote: number}, voteEnabled: boolean): boolean {
    return voteEnabled && game.vote === VOTE_NEUTRAL;
}
