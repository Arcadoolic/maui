import {existsSync, mkdirSync, writeFileSync} from 'fs';
import {join} from 'path';
import * as os from 'os';
import {createHash} from 'crypto';
import {fileUrl} from './RankingBoard';
import type {ApiResult, ChampionLine, GameMediaType} from './MauiApiClient';

/**
 * The champions screen of an idle cabinet (ChampionsScreen.vue, Config.frontIdleScreen): the
 * champions of the day of MAUI-API (maui-api D96, D101), one after the other, each with its game's
 * marquee and flyer. A champion's game may not be on the cabinet: its pictures are then downloaded
 * (maui-api D99) into a cache of their own, named after their hash. Electron-free, so it stays
 * unit-testable.
 */

// Champions asked for, and how long each one is shown.
export const CHAMPIONS_ASKED = 10;
export const CHAMPION_SHOWN_MS = 8000;

const HASH = /^[0-9a-f]{64}$/;

/** Same fixed <home>/.mame-awesome-ui as the database (Database.class.ts). */
export function getChampionMediaPath(): string {
    return join(os.homedir(), '.mame-awesome-ui', 'champion-media');
}

export interface PictureFolders {
    // The cabinet's own pictures of its games (ui.ini's folders), `<romname>.png`.
    local: string | null;
    // The downloaded ones, `<hash>.png`.
    cache: string;
}

/**
 * The address of a game's picture: the cabinet's own when it has the game, else the downloaded
 * one, null when neither is there (yet).
 */
export function championPictureUrl(romname: string, hash: string | null, folders: PictureFolders): string | null {
    if (folders.local && /^[\w-]+$/.test(romname)) {
        const own = join(folders.local, `${romname}.png`);
        if (existsSync(own)) {
            return fileUrl(own);
        }
    }
    if (hash && HASH.test(hash)) {
        const cached = join(folders.cache, `${hash}.png`);
        if (existsSync(cached)) {
            return fileUrl(cached);
        }
    }
    return null;
}

/**
 * Downloads a game's picture the cabinet does not have: kept only when its content is the picture
 * its hash names. Resolves to its address, else null.
 */
export async function fetchChampionPicture(
    champion: ChampionLine, type: GameMediaType,
    getGameMedia: (romname: string, type: GameMediaType) => Promise<ApiResult<Uint8Array>>, cache: string,
): Promise<string | null> {
    const hash = champion[type];
    if (!hash || !HASH.test(hash)) {
        return null;
    }
    const picture = await getGameMedia(champion.romname, type);
    if (picture.kind !== 'ok' || createHash('sha256').update(picture.value).digest('hex') !== hash) {
        return null;
    }
    mkdirSync(cache, {recursive: true});
    const file = join(cache, `${hash}.png`);
    writeFileSync(file, picture.value);
    return fileUrl(file);
}
