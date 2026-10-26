import {MAUI_RELEASES_URL, newestAbove, type ListedRelease, type UpdateChannel} from '@/class/ReleaseList';

// Whether a newer release of MAUI is out, for the idle cabinet's band and the front's update offer
// (Home.vue): asked of GitHub by the main process, whether the BO is loaded or not, a while after
// the start then every few hours - well within the anonymous API's 60 requests an hour. GitHub out
// of reach (OFFLINE without Internet, an error) changes nothing: no error, and no message until it
// answers. The list is kept, not the answer: the update channel (BO) applies at the next reading,
// and the front's update installs the file this same list gives for the version it offered.

export interface WatchedRelease extends ListedRelease {
    assets: {name: string; browser_download_url: string}[];
}

export type ReleasesFetcher = () => Promise<WatchedRelease[]>;

const FIRST_CHECK_MS = 30 * 1000;
const CHECK_EVERY_MS = 6 * 60 * 60 * 1000;

async function fetchReleases(): ReturnType<ReleasesFetcher> {
    const response = await fetch(MAUI_RELEASES_URL, {headers: {Accept: 'application/vnd.github+json'}});
    if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
    }
    return await response.json() as Awaited<ReturnType<ReleasesFetcher>>;
}

export class UpdateWatch {
    private releases: WatchedRelease[] = [];
    private timers: ReturnType<typeof setTimeout>[] = [];

    /**
     * `canInstall`: whether this machine can install a version from its files' names (a Windows
     * cabinet needs the installer, which development builds only carry when asked for).
     */
    public constructor(
        private readonly currentVersion: string,
        private readonly fetcher: ReleasesFetcher = fetchReleases,
        private readonly canInstall: (assetNames: string[]) => boolean = () => true,
    ) {}

    /** Not at once: the start of the application is not slowed down by it. */
    public start(): void {
        const first = setTimeout(() => void this.check(), FIRST_CHECK_MS);
        const every = setInterval(() => void this.check(), CHECK_EVERY_MS);
        // Never what keeps the process alive.
        first.unref?.();
        every.unref?.();
        this.timers.push(first, every);
    }

    /** A failure keeps what was known. Never throws. */
    public async check(): Promise<void> {
        try {
            this.releases = await this.fetcher();
        } catch {
            // Out of reach for now: tried again at the next check.
        }
    }

    /**
     * The newer version on `channel` this machine can install, null when there is none or GitHub
     * never answered.
     */
    public available(channel: UpdateChannel = 'releases'): string | null {
        return newestAbove(this.releases, this.currentVersion, channel, release => this.canInstall(release.assets.map(asset => asset.name)));
    }

    /** A version of the list, with its files; null when GitHub did not list it. */
    public release(tagName: string): WatchedRelease | null {
        return this.releases.find(release => release.tag_name === tagName && !release.draft) ?? null;
    }

    public stop(): void {
        this.timers.forEach(timer => clearTimeout(timer));
        this.timers = [];
    }
}
