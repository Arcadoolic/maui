import {existsSync, readdirSync, readFileSync, rmSync} from 'fs';
import {join} from 'path';
import {pngSize} from '@/class/AvatarForUpload';
import {hasOnlineAvatar} from '@/class/OnlineAvatars';

// The BO's "Check the avatars" (MAUI tab, Online): finds the pictures a player would see as a broken
// image. The cache of the leaderboards' avatars is named after their hash: a file whose content is
// another one is removed, and downloaded again by the refresh the BO asks right after.

const HASH_FILE = /^([0-9a-f]{64})\.png$/;

/** Removes from the leaderboards' cache each `<hash>.png` that is not the picture of that hash; returns their names. */
export function removeBrokenOnlineAvatars(dir: string): string[] {
    if (!existsSync(dir)) {
        return [];
    }
    const removed: string[] = [];
    for (const name of readdirSync(dir)) {
        const hash = HASH_FILE.exec(name)?.[1];
        if (hash && !hasOnlineAvatar(hash, dir)) {
            rmSync(join(dir, name), {force: true});
            removed.push(name);
        }
    }
    return removed;
}

/** The players whose `<pseudo3>.png` is there but is not a PNG the front can show. */
export function brokenLocalAvatars(avatarsDir: string, pseudos: string[]): string[] {
    return pseudos.filter(pseudo3 => {
        const file = join(avatarsDir, `${pseudo3}.png`);
        if (!existsSync(file)) {
            return false;
        }
        try {
            return pngSize(readFileSync(file)) === null;
        } catch {
            return true;
        }
    });
}
