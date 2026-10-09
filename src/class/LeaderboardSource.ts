import {existsSync} from 'fs';
import {join} from 'path';
import {format} from 'url';
import {ipcRenderer} from 'electron';
import * as SequelizeTS from 'sequelize-typescript';
import Game from '@/model/Game.model';
import Hiscore from '@/model/Hiscore.model';
import User from '@/model/User.model';
import {findAvatarFile} from '@/class/AvatarFiles';
import {isOnlineActive} from '@/class/RepositoryAuth';
import {onlineAvatarFile} from '@/class/OnlineAvatars';
import {LEADERBOARDS_CHANGED_CHANNEL} from '@/class/ScoreCaptureBridge';
import type {LeaderboardEntry} from '@/class/MauiApiClient';
import {getConfiguration, getUserService} from '@/services';

const Sequelize = SequelizeTS.Sequelize;

// What the front shows of a game's hiscores (Hiscores.vue, Champions.vue): the local database in
// LOCAL mode, as before; in ONLINE mode the shared leaderboards of MAUI-API (maui-api D52), from
// the cache LeaderboardSync.ts keeps, so they still show when the API cannot be reached. Private
// players are not in them: their scores stay in the local database and show again in LOCAL mode.

export interface BoardRow {
    key: string;
    pseudo3: string;
    score: number;
    // file:// URL, null for the default picture.
    avatar: string | null;
}

export type AvatarResolver = (pseudo3: string, onlineHash: string | null) => string | null;

/** The cached entries of a leaderboard (JSON of the API's entries) as rows, `limit` at most. */
export function toBoardRows(entriesJson: string | null, limit: number, avatarOf: AvatarResolver): BoardRow[] {
    let entries: LeaderboardEntry[];
    try {
        entries = entriesJson ? JSON.parse(entriesJson) as LeaderboardEntry[] : [];
    } catch {
        return [];
    }
    return entries.slice(0, limit).map(entry => ({
        key: `${entry.playerId}/${entry.score}`,
        pseudo3: entry.pseudo3,
        score: entry.score,
        avatar: avatarOf(entry.pseudo3, entry.avatar),
    }));
}

function fileUrl(path: string): string {
    return format({pathname: path, protocol: 'file', slashes: true});
}

/** The downloaded avatar of a player of MAUI-API, else the local one of the same initials. */
function avatarResolver(): AvatarResolver {
    const localFiles = getUserService().getAvatars();
    return (pseudo3, onlineHash) => {
        const online = onlineAvatarFile(onlineHash);
        if (online && existsSync(online)) {
            return fileUrl(online);
        }
        const local = findAvatarFile(localFiles, pseudo3);
        return local ? fileUrl(join(getConfiguration().avatarsPath, local)) : null;
    };
}

/** The picture of one of the cabinet's players, null for the default one. */
export function playerAvatar(pseudo3: string): string | null {
    return avatarResolver()(pseudo3, null);
}

async function onlineRows(game: Game, limit: number): Promise<BoardRow[]> {
    const sequelize = Game.sequelize;
    if (!sequelize) {
        return [];
    }
    const [rows] = await sequelize.query(
        'SELECT entries FROM online_leaderboard WHERE romname = ? AND table_name = ?',
        {replacements: [game.romName, 'default']},
    ) as [{entries: string}[], unknown];
    return toBoardRows(rows[0]?.entries ?? null, limit, avatarResolver());
}

function localRows(hiscores: Hiscore[]): BoardRow[] {
    const avatarOf = avatarResolver();
    return hiscores.map(hiscore => ({
        key: String(hiscore.id_hiscore),
        pseudo3: hiscore.user.pseudo_3,
        score: hiscore.score,
        avatar: avatarOf(hiscore.user.pseudo_3, null),
    }));
}

/** The hiscores table: 9 rows, best first. */
export async function loadHiscores(game: Game): Promise<BoardRow[]> {
    if (isOnlineActive()) {
        return onlineRows(game, 9);
    }
    return localRows(await game.$get('hiscores', {
        // required: a deleted player's scores stay in the database but are not shown
        include: [{model: User, required: true}], limit: 9, order: [['score', 'DESC']], group: ['score', 'user.id_user'],
    }) as Hiscore[] || []);
}

/** The podium: the best 3 players, best first. */
export async function loadChampions(game: Game): Promise<BoardRow[]> {
    if (isOnlineActive()) {
        return onlineRows(game, 3);
    }
    return localRows(await game.$get('hiscores', {
        include: [{model: User, required: true}],
        attributes: {include: [[Sequelize.fn('MAX', Sequelize.col('score')), 'max_score']]},
        limit: 3,
        order: [['score', 'DESC']],
        group: ['user.id_user'],
    }) as Hiscore[] || []);
}

/**
 * The games of the cached leaderboards that hold a score, the one scored on last first (then by
 * name). A damaged cache entry counts as empty.
 */
export function lastScoredRomnames(leaderboards: {romname: string; entries: string}[]): string[] {
    const lastScores: {romname: string; at: number}[] = [];
    for (const leaderboard of leaderboards) {
        let entries: LeaderboardEntry[];
        try {
            entries = JSON.parse(leaderboard.entries) as LeaderboardEntry[];
        } catch {
            continue;
        }
        if (!Array.isArray(entries) || !entries.length) {
            continue;
        }
        // A date that cannot be read sorts last rather than hiding the game.
        const at = Math.max(...entries.map(entry => Date.parse(entry.achievedAt) || 0));
        lastScores.push({romname: leaderboard.romname, at});
    }
    return lastScores
        .sort((a, b) => b.at - a.at || (a.romname < b.romname ? -1 : a.romname > b.romname ? 1 : 0))
        .map(lastScore => lastScore.romname);
}

async function beatThisRomnames(): Promise<string[]> {
    const sequelize = Game.sequelize;
    if (!sequelize) {
        return [];
    }
    if (isOnlineActive()) {
        const [leaderboards] = await sequelize.query(
            'SELECT romname, entries FROM online_leaderboard WHERE table_name = ?',
            {replacements: ['default']},
        ) as [{romname: string; entries: string}[], unknown];
        return lastScoredRomnames(leaderboards);
    }
    // Same scores as loadHiscores(): those of a deleted player are not shown, so do not count.
    // creationDate is when the cabinet first read the score in the game's file.
    const [rows] = await sequelize.query(
        'SELECT game.romName AS romname, MAX(hiscore.creationDate) AS last_score FROM hiscore'
        + ' JOIN "user" ON "user".id_user = hiscore.id_user AND "user".deletionDate IS NULL'
        + ' JOIN game ON game.id_game = hiscore.id_game'
        + ' WHERE hiscore.deletionDate IS NULL'
        + ' GROUP BY game.romName ORDER BY last_score DESC, game.romName',
    ) as [{romname: string}[], unknown];
    return rows.map(row => row.romname);
}

/**
 * The "Beat This!" carousel category: the games players have a score on, the one scored on
 * last first. The scores are those the front shows (see the top of this file): the shared
 * leaderboards in ONLINE mode, the local database otherwise. Queried on every call, like
 * GameService.loadHiscoreGames().
 */
export async function loadBeatThisGames(): Promise<Game[]> {
    const romnames = await beatThisRomnames();
    if (!romnames.length) {
        return [];
    }
    // A leaderboard can outlive its game on this cabinet (removed favorite): findAll() drops it.
    const games = await Game.findAll({where: {romName: romnames}});
    const position = new Map(romnames.map((romname, index) => [romname, index]));
    return games.sort((a, b) => position.get(a.romName)! - position.get(b.romName)!);
}

/** Calls `listener` when MAUI-API's leaderboards changed; returns how to stop. */
export function onLeaderboardsChanged(listener: () => void): () => void {
    const handler = () => listener();
    ipcRenderer.on(LEADERBOARDS_CHANGED_CHANNEL, handler);
    return () => ipcRenderer.off(LEADERBOARDS_CHANGED_CHANNEL, handler);
}
