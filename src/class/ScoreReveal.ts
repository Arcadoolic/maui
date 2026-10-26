import type {BoardRow} from '@/class/LeaderboardSource';

// What a game just played added to its leaderboard (Home.vue's score reveal): the rows not there
// when it was launched. A row's key changes with its score (LeaderboardSource.ts), so a player who
// beat their own best shows as new, at their new place.

/** The keys of the rows of `rows` whose key was not in `before`. */
export function freshScores(before: string[], rows: BoardRow[]): string[] {
    const known = new Set(before);
    return rows.filter(row => !known.has(row.key)).map(row => row.key);
}
