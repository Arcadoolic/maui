import {mkdirSync, rmSync, writeFileSync} from 'fs';
import {join} from 'path';

/**
 * The game's podium for maui-podium-overlay's MAME plugin (`podium`, installed from the
 * configuration pack, PackPlugins.ts): written before each game the front launches, in the mame
 * home (MAME's current directory), where the plugin reads it to draw the best 3 players in a
 * corner. The same 3 as on the game's marquee (LeaderboardSource.ts loadChampions()).
 */

export const PODIUM_FOLDER = 'maui-podium';

export interface PodiumRow {
    name: string;
    score: number;
}

export function podiumFilePath(mameHome: string, romName: string): string {
    return join(mameHome, PODIUM_FOLDER, `${romName}.json`);
}

/**
 * Writes the game's podium, best first, 3 rows at most; removes the file when there is none, so
 * that the plugin never shows an older one. Never throws: the game starts all the same.
 */
export function writePodiumFile(mameHome: string, romName: string, rows: readonly PodiumRow[]): void {
    const path = podiumFilePath(mameHome, romName);
    try {
        if (!/^[a-z0-9_]+$/.test(romName)) {
            return;
        }
        if (!rows.length) {
            rmSync(path, {force: true});
            return;
        }
        mkdirSync(join(mameHome, PODIUM_FOLDER), {recursive: true});
        writeFileSync(path, JSON.stringify({rows: rows.slice(0, 3).map(row => ({name: row.name, score: row.score}))}));
    } catch {
        // The podium in a corner is a nicety: nothing to do without it.
    }
}
