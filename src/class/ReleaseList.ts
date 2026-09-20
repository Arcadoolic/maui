/**
 * Helpers for the BO's "Update" list of GitHub releases (see boServer.ts's getUpdateInfo()).
 */

/**
 * Newest first, by publication time. GitHub's /releases endpoint can't be relied on for this: it
 * orders by `created_at`, which is the date of the *commit* a release's tag points at, not when the
 * release was published - so several develop prereleases cut minutes apart, or one whose commit is
 * older than a sibling's, come back out of order. Returns a new array; the input isn't mutated.
 * An unparseable date sorts last.
 */
export function sortByPublishedDesc<T extends {publishedAt: string}>(entries: T[]): T[] {
    const time = (entry: T): number => {
        const parsed = Date.parse(entry.publishedAt);
        return Number.isNaN(parsed) ? -Infinity : parsed;
    };
    return [...entries].sort((a, b) => {
        const diff = time(b) - time(a);
        // -Infinity - -Infinity is NaN: two unparseable dates keep their original order.
        return Number.isNaN(diff) ? 0 : diff;
    });
}

/**
 * Publication date *and time* (down to the second) in the machine's local timezone, e.g.
 * "18/09/2026, 20:24:16" - a date alone can't tell apart the several builds a busy day produces.
 * Falls back to the raw string for an unparseable date rather than showing "Invalid Date".
 */
export function formatPublishedAt(iso: string): string {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) {
        return iso;
    }
    return date.toLocaleString('en-GB', {dateStyle: 'short', timeStyle: 'medium'});
}
