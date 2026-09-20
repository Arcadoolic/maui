/**
 * A studio as mame reports it can already carry a note in parentheses ("NMK (Jaleco license)",
 * "Irem (licensed from Hudson Soft)"). Shown inside parentheses of its own, next to the year,
 * that read "(NMK (Jaleco license))": each such note becomes a ", note" instead, giving
 * "NMK, Jaleco license". A studio without a note is returned as is.
 */
export function studioInParentheses(studio: string): string {
    return studio.replace(/\s*\(([^()]*)\)/g, ', $1');
}
