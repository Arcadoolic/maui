import {existsSync, mkdirSync, readFileSync, writeFileSync} from 'fs';
import {join, dirname} from 'path';
import * as os from 'os';
import {removeFavorite} from '@/class/MameIniParser';

/*
 * The favorites files of mame-awesome-ui's own state directory, and the removal of a favorite
 * from mame's favorites.ini - shared by the BO server (Games tab: "remove" button) and the
 * renderer (a thumbs down on a game, see GameService.applyVote()). Electron-free like
 * MameIniParser: boServer.ts can't import anything that pulls @electron/remote in (see its header
 * comment).
 */

/**
 * Same fixed <home>/.mame-awesome-ui path as Database.class.ts's getDatabasePath(), for the
 * favorites name/BIOS cache (see FavoritesCache below) - resolving a favorite's fullname/BIOS is a
 * blocking `mame -lx` process spawn per rom (see getGameXmlInfo()), so the favorites tab reads
 * this cache instead of re-running it on every page load; only "Update favorites" re-resolves
 * and rewrites it.
 */
export function getFavoritesCachePath(): string {
    const appDataPath = join(os.homedir(), '.mame-awesome-ui');
    if (!existsSync(appDataPath)) {
        mkdirSync(appDataPath, {recursive: true});
    }
    return join(appDataPath, 'favorites-cache.json');
}

export interface FavoritesCacheEntry {
    fullname: string;
    biosName: string | null;
    deviceRoms: string[];
}

export interface FavoritesCache {
    updatedAt: string;
    entries: { [romName: string]: FavoritesCacheEntry };
}

export function readFavoritesCache(): FavoritesCache | null {
    const cachePath = getFavoritesCachePath();
    if (!existsSync(cachePath)) {
        return null;
    }
    try {
        return JSON.parse(readFileSync(cachePath, 'utf8'));
    } catch {
        // Corrupt/unreadable cache file - treat as absent rather than failing the whole tab.
        return null;
    }
}

export function writeFavoritesCache(entries: { [romName: string]: FavoritesCacheEntry }): FavoritesCache {
    const cache: FavoritesCache = {updatedAt: new Date().toISOString(), entries};
    writeFileSync(getFavoritesCachePath(), JSON.stringify(cache));
    return cache;
}

/**
 * A favorite removed from the Games tab: the exact favorites.ini block mame had written for it
 * (see removeFavorite()), plus its cached name/BIOS, so "Restore" can put both back as they were.
 * Stored beside the favorites cache rather than in favorites.ini itself, which is mame's own file
 * (it rewrites it from memory on exit and would drop anything foreign).
 */
export interface RemovedFavorite {
    romName: string;
    fullname: string;
    removedAt: string;
    entry: string;
    cache?: FavoritesCacheEntry;
}

export function getRemovedFavoritesPath(): string {
    return join(dirname(getFavoritesCachePath()), 'removed-favorites.json');
}

export function readRemovedFavorites(): RemovedFavorite[] {
    const path = getRemovedFavoritesPath();
    if (!existsSync(path)) {
        return [];
    }
    try {
        const parsed = JSON.parse(readFileSync(path, 'utf8'));
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        // Corrupt/unreadable file - treat as empty rather than failing the whole tab.
        return [];
    }
}

export function writeRemovedFavorites(removed: RemovedFavorite[]): void {
    writeFileSync(getRemovedFavoritesPath(), JSON.stringify(removed));
}

/**
 * Removes a rom from favorites.ini, keeping what "Restore" needs (see RemovedFavorite). Returns
 * the removed favorite's name, or null - nothing touched - when the entry isn't in the file or
 * the file doesn't have the layout removeFavorite() expects.
 */
export function removeFavoriteFromDisk(favoritesPath: string, romName: string): {fullname: string} | null {
    const removal = removeFavorite(readFileSync(favoritesPath, 'utf8'), romName);
    if (removal === null) {
        return null;
    }

    // Saved before favorites.ini is rewritten: if this write fails the favorite is still
    // listed (worst case, a stale "removed" record the removed subtab hides), whereas the
    // other order could lose the entry for good.
    const cache = readFavoritesCache();
    const fullname = removal.entry.split('\n')[1]?.trim() || cache?.entries[romName]?.fullname || romName;
    writeRemovedFavorites([
        ...readRemovedFavorites().filter(item => item.romName !== romName),
        {
            romName,
            fullname,
            removedAt: new Date().toISOString(),
            entry: removal.entry,
            cache: cache?.entries[romName],
        },
    ]);
    writeFileSync(favoritesPath, removal.content, 'utf8');

    // Drop the rom's cached name/BIOS too, keeping the rest of the cache (and its updatedAt)
    // as it was - restored later, it gets its cache entry back from the removed record.
    if (cache?.entries[romName]) {
        delete cache.entries[romName];
        writeFileSync(getFavoritesCachePath(), JSON.stringify(cache));
    }
    return {fullname};
}
