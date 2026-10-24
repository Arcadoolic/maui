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

// Earlier releases the list still shows under the installed one: enough to step back after a bad
// update, without the whole history.
export const MAX_OLDER_RELEASES = 3;

/** "2.8.0" or "2.8.0+dev.1a2b3c4" (a develop build, see getRunningVersion()) as [2, 8, 0]; null for anything else. */
function parseVersion(version: string): number[] | null {
    const match = /^v?(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(version.trim());
    return match ? match.slice(1, 4).map(Number) : null;
}

/**
 * Whether `tagName` is a version under `currentVersion`. What follows the three numbers is not
 * compared: a develop build is neither older nor newer than the release of the same number. A
 * version that cannot be read is never taken for an older one.
 */
export function isOlderVersion(tagName: string, currentVersion: string): boolean {
    const tag = parseVersion(tagName);
    const current = parseVersion(currentVersion);
    if (!tag || !current) {
        return false;
    }
    for (let i = 0; i < 3; i++) {
        if (tag[i] !== current[i]) {
            return tag[i] < current[i];
        }
    }
    return false;
}

/**
 * `entries` (newest first, see sortByPublishedDesc()) without the versions under `currentVersion`
 * past the first `max` of them.
 */
export function limitOlderReleases<T extends {tagName: string}>(
    entries: T[], currentVersion: string, max: number = MAX_OLDER_RELEASES,
): T[] {
    let older = 0;
    return entries.filter(entry => !isOlderVersion(entry.tagName, currentVersion) || ++older <= max);
}

/**
 * Where MAUI's releases are published (GitHub's /releases API, public, no auth needed). 100 a
 * page, GitHub's most: every push to develop publishes a development build, and with the default
 * 30 the running release could fall off the page (newestAbove() dates development builds by it).
 */
export const MAUI_RELEASES_URL = 'https://api.github.com/repos/Arcadoolic/maui/releases?per_page=100';

/** The update channels of the BO's MAUI tab: the releases, or the development builds too. */
export type UpdateChannel = 'releases' | 'prereleases';

export function parseUpdateChannel(value: unknown): UpdateChannel {
    return value === 'prereleases' ? 'prereleases' : 'releases';
}

/**
 * The newest stable release above `currentVersion`, null when there is none. Develop builds
 * (prereleases) and drafts do not count: a cabinet is only told of a real release.
 */
export function newestStableAbove(
    releases: readonly {tag_name: string; prerelease: boolean; draft?: boolean}[], currentVersion: string,
): string | null {
    let newest: string | null = null;
    for (const release of releases) {
        if (release.prerelease || release.draft || !isOlderVersion(currentVersion, release.tag_name)) {
            continue;
        }
        if (newest === null || isOlderVersion(newest, release.tag_name)) {
            newest = release.tag_name;
        }
    }
    return newest;
}

export interface ListedRelease {
    tag_name: string;
    prerelease: boolean;
    draft?: boolean;
    published_at?: string;
}

function publishedTime(release: ListedRelease): number {
    return Date.parse(release.published_at ?? '');
}

/** Same three numbers: a development build and the release it leads to, or two development builds. */
function isSameVersion(a: string, b: string): boolean {
    return parseVersion(a) !== null && parseVersion(b) !== null && !isOlderVersion(a, b) && !isOlderVersion(b, a);
}

/**
 * The newest version above `currentVersion` on `channel`, null when there is none. On the
 * releases channel, newestStableAbove(). With the development builds too, every build of develop
 * carries the number of the release before it ("2.17.0+dev.1a2b3c4", see build.yml): two versions
 * of the same number are told apart by their publication, newer when published after the running
 * one. A running version GitHub does not list (too old, or a local build) has no date: only a
 * higher number is newer then. Drafts never count.
 */
export function newestAbove(
    releases: readonly ListedRelease[], currentVersion: string, channel: UpdateChannel,
): string | null {
    if (channel === 'releases') {
        return newestStableAbove(releases, currentVersion);
    }
    const running = releases.find(release => release.tag_name === currentVersion);
    const runningTime = running ? publishedTime(running) : NaN;
    const isNewer = (release: ListedRelease, than: string, thanTime: number): boolean =>
        isOlderVersion(than, release.tag_name)
        || (isSameVersion(release.tag_name, than) && publishedTime(release) > thanTime);

    let newest: ListedRelease | null = null;
    for (const release of releases) {
        if (release.draft || release.tag_name === currentVersion || !isNewer(release, currentVersion, runningTime)) {
            continue;
        }
        if (newest === null || isNewer(release, newest.tag_name, publishedTime(newest))) {
            newest = release;
        }
    }
    return newest?.tag_name ?? null;
}
