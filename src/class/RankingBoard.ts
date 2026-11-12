import {mkdirSync, writeFileSync} from 'fs';
import {createHash} from 'crypto';
import {format} from 'url';
import {getOnlineAvatarsPath, hasOnlineAvatar, onlineAvatarFile} from './OnlineAvatars';
import type {ApiResult, RankingLine} from './MauiApiClient';

/**
 * The hiscores board (Home.vue's Hiscores board action, RankingBoard.vue): the global podium of
 * MAUI-API (maui-api D100). Its first BOARD_VISIBLE players come in from the right one after the
 * other; with more, the board scrolls up slowly, one leaving at the top as the next comes in at the
 * bottom; at the end of the cycle it goes away by itself. Electron-free, so it stays unit-testable.
 */

// Players asked for, and shown at once.
export const BOARD_PLAYERS = 25;
export const BOARD_VISIBLE = 10;

export const BOARD_TIMINGS = {
    // Between two players coming in.
    enterEveryMs: 250,
    // How long one takes to cross the screen (RankingBoard.vue's transition).
    enterMs: 600,
    // The full board stays still this long before it scrolls.
    holdMs: 4000,
    // Between two steps of the scroll.
    scrollEveryMs: 2500,
    // The last board stays this long before going away.
    endMs: 4000,
    // Nothing to show (no player yet, MAUI-API out of reach): the message stays this long.
    emptyMs: 3000,
};

export type BoardStep =
    | {atMs: number; kind: 'enter'; index: number}
    | {atMs: number; kind: 'scroll'; index: number}
    | {atMs: number; kind: 'end'};

/** When each of `count` players comes in (or the board scrolls to it), and when the board ends. */
export function boardTimeline(count: number, visible = BOARD_VISIBLE, timings = BOARD_TIMINGS): BoardStep[] {
    if (count <= 0) {
        return [{atMs: timings.emptyMs, kind: 'end'}];
    }
    const steps: BoardStep[] = [];
    const shown = Math.min(count, visible);
    for (let index = 0; index < shown; index++) {
        steps.push({atMs: index * timings.enterEveryMs, kind: 'enter', index});
    }
    // The last one in has crossed the screen: the board stays still a while.
    let at = (shown - 1) * timings.enterEveryMs + timings.enterMs + timings.holdMs;
    for (let index = shown; index < count; index++) {
        steps.push({atMs: at, kind: 'scroll', index});
        at += timings.scrollEveryMs;
    }
    // After a scroll, its step's time already went by; without one, the hold did.
    steps.push({atMs: count > shown ? at - timings.scrollEveryMs + timings.endMs : at - timings.holdMs + timings.endMs, kind: 'end'});
    return steps;
}

export function fileUrl(path: string): string {
    return format({pathname: path, protocol: 'file', slashes: true});
}

/** A player with an avatar of MAUI-API: a line of the podium, a champion (ChampionsScreen.ts). */
export type AvatarOwner = Pick<RankingLine, 'playerId' | 'avatar'>;

/** The address of a player's downloaded avatar, null when the cache does not have it (yet). */
export function rankingAvatarUrl(line: AvatarOwner, dir: string = getOnlineAvatarsPath()): string | null {
    const file = onlineAvatarFile(line.avatar, dir);
    return file && line.avatar && hasOnlineAvatar(line.avatar, dir) ? fileUrl(file) : null;
}

/**
 * Downloads an avatar the cache does not have, as LeaderboardSync does for the leaderboards:
 * kept only when its content is the picture its hash names. Resolves to its address, else null.
 */
export async function fetchRankingAvatar(
    line: AvatarOwner, getAvatar: (playerId: string) => Promise<ApiResult<Uint8Array>>, dir: string = getOnlineAvatarsPath(),
): Promise<string | null> {
    const file = onlineAvatarFile(line.avatar, dir);
    if (!file || !line.avatar) {
        return null;
    }
    const png = await getAvatar(line.playerId);
    if (png.kind !== 'ok' || createHash('sha256').update(png.value).digest('hex') !== line.avatar) {
        return null;
    }
    mkdirSync(dir, {recursive: true});
    writeFileSync(file, png.value);
    return fileUrl(file);
}
