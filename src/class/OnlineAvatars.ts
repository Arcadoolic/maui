import {join} from 'path';
import * as os from 'os';

// Avatars of the players of the shared leaderboards (maui-api D53), downloaded from MAUI-API and
// named after their SHA-256: a file is there once, whatever the player, and a changed avatar is a
// new file. Read by the front (LeaderboardSource.ts) and written by the main process
// (LeaderboardSync.ts), hence this module of its own, without Electron or database.

const HASH = /^[0-9a-f]{64}$/;

/** Same fixed <home>/.mame-awesome-ui as the database (Database.class.ts). */
export function getOnlineAvatarsPath(): string {
    return join(os.homedir(), '.mame-awesome-ui', 'online-avatars');
}

/** The file of an avatar hash, null for anything that is not one (never a path from the API). */
export function onlineAvatarFile(hash: string | null, dir: string = getOnlineAvatarsPath()): string | null {
    return hash !== null && HASH.test(hash) ? join(dir, `${hash}.png`) : null;
}
