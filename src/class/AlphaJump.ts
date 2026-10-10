/**
 * Letter jumps of the front's game list (Home.vue): holding up or down in "All games" or "Hiscores only"
 * goes from one initial to the next instead of one game at a time. The initial is the one of the title the
 * front shows above the list, which is also what the list is ordered by (GameService's
 * GAMES_BY_TITLE): the jumps follow the order the games are in. Electron-free.
 */

/** Initial of the games whose title starts with anything but a letter (005, 1942, 64th. Street). */
export const OTHER_LETTER = '#';

export function getLetter(title: string): string {
    const initial = title.charAt(0).toUpperCase();
    return initial >= 'A' && initial <= 'Z' ? initial : OTHER_LETTER;
}

/** The initials the list has, in the order it meets them. */
export function getLetters(titles: string[]): string[] {
    return [...new Set(titles.map(getLetter))];
}

/**
 * Where a jump from `index` lands: the first game of the next initial, or of the previous one,
 * wrapping around like the list itself. A list with a single initial goes back to its first game.
 */
export function getJumpIndex(titles: string[], index: number, previous: boolean): number {
    if (!titles.length) {
        return 0;
    }
    const letters = getLetters(titles);
    const current = letters.indexOf(getLetter(titles[Math.min(Math.max(index, 0), titles.length - 1)]));
    const target = letters[(current + (previous ? -1 : 1) + letters.length) % letters.length];
    return titles.findIndex(title => getLetter(title) === target);
}
