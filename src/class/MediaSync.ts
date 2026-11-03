import {createHash} from 'crypto';
import {existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync} from 'fs';
import {dirname, join} from 'path';
import {GAME_MEDIA_TYPES, type ApiFailure, type GameMediaHashes, type GameMediaType, type MauiApiClient} from '@/class/MauiApiClient';

// The marquee, flyer and logo of the cabinet's games made those MAUI-API chose for every place
// they are shown (maui-api D99: Europe first, a priority region and a media donor per game), so
// that a cabinet, the packs and the hiscores front show the same pictures. Run by OnlineSession;
// Electron-free, so the main process (boCore.ts) runs it and the tests too.
//
// GET /media lists the hash of each picture; a file whose hash differs is downloaded and written
// as `<rom>.png` in ui.ini's folder (whatever its format: flyers are mostly JPEG, as the packs
// always shipped them). A picture the API has none of is left as it is. The hash of each file
// written is kept with its size and date (media-sync.json), not to read every picture again.

/** Once every 6 hours at most; a forced sync (the BO) asks at once. */
export const MEDIA_SYNC_EVERY_MS = 6 * 60 * 60 * 1000;

export type MediaFolders = Record<GameMediaType, string | null>;

export interface MediaSyncDeps {
    statePath: string;
    // The games of the cabinet.
    romnames(): Promise<string[]>;
    // ui.ini's marquees, flyers and logos folders; null when not set.
    folders(): MediaFolders;
    // A game is being played: no more downloads until the next turn.
    paused(): boolean;
    now?(): number;
}

export interface MediaSyncSummary {
    // False when it was not time to ask yet.
    checked: boolean;
    // `<rom>/<type>` written.
    written: string[];
    failed: string[];
    stoppedForGame: boolean;
    failure?: ApiFailure;
}

interface FileStamp {
    size: number;
    mtimeMs: number;
    hash: string;
}

interface MediaSyncState {
    checkedAt: number;
    etag: string | null;
    // The last list, for an answer 304.
    games: GameMediaHashes;
    // By file path.
    files: Record<string, FileStamp>;
}

const EMPTY_STATE: MediaSyncState = {checkedAt: 0, etag: null, games: {}, files: {}};

const sha256 = (content: Uint8Array): string => createHash('sha256').update(content).digest('hex');

export class MediaSync {
    private readonly listeners: ((romnames: string[]) => void)[] = [];
    private running: Promise<MediaSyncSummary> | null = null;

    public constructor(private readonly deps: MediaSyncDeps) {}

    /** Told the games whose pictures changed (the front shows them again). */
    public onChange(listener: (romnames: string[]) => void): void {
        this.listeners.push(listener);
    }

    /** One at a time: a second call waits for the one in progress. Never throws. */
    public sync(client: MauiApiClient, options: {force?: boolean} = {}): Promise<MediaSyncSummary> {
        if (!this.running) {
            this.running = this.run(client, options.force ?? false)
                .finally(() => {
                    this.running = null;
                });
        }
        return this.running;
    }

    private async run(client: MauiApiClient, force: boolean): Promise<MediaSyncSummary> {
        const summary: MediaSyncSummary = {checked: false, written: [], failed: [], stoppedForGame: false};
        const now = this.deps.now?.() ?? Date.now();
        const state = this.readState();
        if (!force && state.checkedAt > 0 && now - state.checkedAt < MEDIA_SYNC_EVERY_MS) {
            return summary;
        }
        summary.checked = true;
        const answer = await client.getMedia(state.etag);
        if (answer.kind !== 'ok') {
            summary.failure = answer;
            return summary;
        }
        if (!answer.value.notModified) {
            state.etag = answer.value.etag;
            state.games = answer.value.value;
        }
        const folders = this.deps.folders();
        const changed = new Set<string>();
        for (const romname of [...new Set(await this.deps.romnames())].sort()) {
            for (const type of GAME_MEDIA_TYPES) {
                const wanted = state.games[romname]?.[type];
                const folder = folders[type];
                if (!wanted || !folder) {
                    continue;
                }
                const file = join(folder, `${romname}.png`);
                if (this.hashOf(file, state) === wanted) {
                    continue;
                }
                if (this.deps.paused()) {
                    summary.stoppedForGame = true;
                    break;
                }
                const picture = await client.getGameMedia(romname, type);
                if (picture.kind !== 'ok' || sha256(picture.value) !== wanted) {
                    summary.failed.push(`${romname}/${type}`);
                    continue;
                }
                this.write(file, picture.value, wanted, state);
                summary.written.push(`${romname}/${type}`);
                changed.add(romname);
            }
            if (summary.stoppedForGame) {
                break;
            }
        }
        // Done once all is there: what failed or was left for a game is asked again next turn.
        if (!summary.stoppedForGame && summary.failed.length === 0) {
            state.checkedAt = now;
        }
        this.saveState(state);
        if (changed.size) {
            this.listeners.forEach(listener => listener([...changed]));
        }
        return summary;
    }

    /** The file's hash, read again only when its size or date moved since it was last read. */
    private hashOf(file: string, state: MediaSyncState): string | null {
        if (!existsSync(file)) {
            return null;
        }
        const stat = statSync(file);
        const stamp = state.files[file];
        if (stamp && stamp.size === stat.size && stamp.mtimeMs === stat.mtimeMs) {
            return stamp.hash;
        }
        const hash = sha256(readFileSync(file));
        state.files[file] = {size: stat.size, mtimeMs: stat.mtimeMs, hash};
        return hash;
    }

    /** Written next to it then renamed: the front never reads half a picture. */
    private write(file: string, content: Uint8Array, hash: string, state: MediaSyncState): void {
        mkdirSync(dirname(file), {recursive: true});
        const partial = `${file}.part`;
        writeFileSync(partial, content);
        renameSync(partial, file);
        const stat = statSync(file);
        state.files[file] = {size: stat.size, mtimeMs: stat.mtimeMs, hash};
    }

    private readState(): MediaSyncState {
        try {
            const state = JSON.parse(readFileSync(this.deps.statePath, 'utf8')) as Partial<MediaSyncState>;
            return {
                checkedAt: typeof state.checkedAt === 'number' ? state.checkedAt : 0,
                etag: typeof state.etag === 'string' ? state.etag : null,
                games: state.games && typeof state.games === 'object' ? state.games : {},
                files: state.files && typeof state.files === 'object' ? state.files : {},
            };
        } catch {
            return {...EMPTY_STATE, games: {}, files: {}};
        }
    }

    private saveState(state: MediaSyncState): void {
        try {
            mkdirSync(dirname(this.deps.statePath), {recursive: true});
            writeFileSync(this.deps.statePath, JSON.stringify(state));
        } catch (error) {
            console.warn(`[media] ${this.deps.statePath} not written: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
}
