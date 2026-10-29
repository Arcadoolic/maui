import type {ApiFailure, Leaderboard, MauiApiClient} from '@/class/MauiApiClient';

// The shared leaderboards of the games of this cabinet (maui-api D52), kept in a local cache for the
// front (LeaderboardSource.ts), with the avatars of their players (maui-api D53). Asked by batches
// of 100 games, each with the ETag of its last answer: an unchanged batch costs a 304.

export const LEADERBOARD_BATCH_SIZE = 100;

export interface LeaderboardStore {
    save(leaderboards: Leaderboard[]): Promise<void>;
}

export interface AvatarCache {
    has(hash: string): boolean;
    save(hash: string, png: Uint8Array): void;
}

export interface LeaderboardSyncDeps {
    store: LeaderboardStore;
    avatars: AvatarCache;
    // The games of this cabinet.
    romnames(): Promise<string[]>;
}

export interface LeaderboardRefresh {
    // Leaderboards received (not 304).
    updated: number;
    avatars: number;
    failure?: ApiFailure;
}

export class LeaderboardSync {
    // ETag of the last answer, by batch (its romnames).
    private readonly etags = new Map<string, string>();
    private readonly listeners: (() => void)[] = [];

    public constructor(private readonly deps: LeaderboardSyncDeps) {}

    /** Called after a refresh that changed something: the front shows it again. */
    public onChange(listener: () => void): void {
        this.listeners.push(listener);
    }

    /**
     * Never throws; stops at the first failed batch, the cache keeps what it had. `first`, the
     * game just played, is asked on its own before the others, and the front told at once when it
     * changed: its new scores show without waiting for the rest of the cabinet's games.
     */
    public async refresh(client: MauiApiClient, first?: string): Promise<LeaderboardRefresh> {
        const result: LeaderboardRefresh = {updated: 0, avatars: 0};
        const romnames = [...new Set(await this.deps.romnames())].sort();
        const batches: string[][] = first && romnames.includes(first) ? [[first]] : [];
        for (let start = 0; start < romnames.length; start += LEADERBOARD_BATCH_SIZE) {
            batches.push(romnames.slice(start, start + LEADERBOARD_BATCH_SIZE));
        }
        let untold = false;
        try {
            for (const batch of batches) {
                const changed = await this.refreshBatch(client, batch, result);
                if (typeof changed !== 'boolean') {
                    result.failure = changed;
                    break;
                }
                untold ||= changed;
                if (untold && batch.length === 1 && batch[0] === first) {
                    this.tell();
                    untold = false;
                }
            }
        } finally {
            if (untold) {
                this.tell();
            }
        }
        return result;
    }

    private tell(): void {
        this.listeners.forEach(listener => listener());
    }

    /** One batch into the cache: whether something changed, or the API's failure. */
    private async refreshBatch(client: MauiApiClient, batch: string[], result: LeaderboardRefresh): Promise<boolean | ApiFailure> {
        const key = batch.join(',');
        const answer = await client.getLeaderboards(batch, this.etags.get(key) ?? null);
        if (answer.kind !== 'ok') {
            return answer;
        }
        if (answer.value.notModified) {
            return false;
        }
        await this.deps.store.save(answer.value.value);
        result.updated += answer.value.value.length;
        const avatars = await this.fetchAvatars(client, answer.value.value);
        result.avatars += avatars.fetched;
        // An avatar that could not be downloaded: the batch is asked again in full next
        // time, instead of a 304 that would leave its players on their previous picture.
        if (answer.value.etag && avatars.missing === 0) {
            this.etags.set(key, answer.value.etag);
        } else {
            this.etags.delete(key);
        }
        return answer.value.value.length > 0 || avatars.fetched > 0;
    }

    /** The avatars of these leaderboards not in the cache yet: those downloaded, those still missing. */
    private async fetchAvatars(client: MauiApiClient, leaderboards: Leaderboard[]): Promise<{fetched: number; missing: number}> {
        const missing = new Map<string, string>();
        for (const entry of leaderboards.flatMap(leaderboard => leaderboard.entries)) {
            if (entry.avatar && !this.deps.avatars.has(entry.avatar)) {
                missing.set(entry.avatar, entry.playerId);
            }
        }
        let fetched = 0;
        for (const [hash, playerId] of missing) {
            const png = await client.getAvatar(playerId);
            if (png.kind === 'ok') {
                this.deps.avatars.save(hash, png.value);
                fetched++;
            }
        }
        return {fetched, missing: missing.size - fetched};
    }
}
