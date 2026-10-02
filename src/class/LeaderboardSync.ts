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

    /** Never throws; stops at the first failed batch, the cache keeps what it had. */
    public async refresh(client: MauiApiClient): Promise<LeaderboardRefresh> {
        const result: LeaderboardRefresh = {updated: 0, avatars: 0};
        const romnames = [...new Set(await this.deps.romnames())].sort();
        try {
            for (let start = 0; start < romnames.length; start += LEADERBOARD_BATCH_SIZE) {
                const batch = romnames.slice(start, start + LEADERBOARD_BATCH_SIZE);
                const key = batch.join(',');
                const answer = await client.getLeaderboards(batch, this.etags.get(key) ?? null);
                if (answer.kind !== 'ok') {
                    result.failure = answer;
                    break;
                }
                if (answer.value.notModified) {
                    continue;
                }
                await this.deps.store.save(answer.value.value);
                if (answer.value.etag) {
                    this.etags.set(key, answer.value.etag);
                }
                result.updated += answer.value.value.length;
                result.avatars += await this.fetchAvatars(client, answer.value.value);
            }
        } finally {
            if (result.updated > 0 || result.avatars > 0) {
                this.listeners.forEach(listener => listener());
            }
        }
        return result;
    }

    /** The avatars of these leaderboards not in the cache yet. */
    private async fetchAvatars(client: MauiApiClient, leaderboards: Leaderboard[]): Promise<number> {
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
        return fetched;
    }
}
