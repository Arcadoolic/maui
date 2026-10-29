// The file the BO's Favorites tab exports the cabinet's starred games to ("My favourites", see
// GameVote.ts), and imports them from: on another cabinet, or the same one after a reinstall.
// JSON, a list of rom names with their titles for whoever reads it. Electron-free, unit-tested.

export const STARRED_FILE_FORMAT = 'maui-my-favourites';
const STARRED_FILE_VERSION = 1;
// A cabinet holds a few hundred games: well beyond, the file is not one of ours.
export const MAX_STARRED_GAMES = 10_000;
export const MAX_STARRED_FILE_BYTES = 1024 * 1024;

// What MAME names a rom (also what /votes/set accepts).
const ROM_NAME = /^[a-z0-9_]{1,32}$/;

export interface StarredGame {
    romName: string;
    name: string;
}

/** The export file's content, games in the order given. */
export function buildStarredFile(games: StarredGame[], exportedAt: Date): string {
    return JSON.stringify({
        format: STARRED_FILE_FORMAT,
        version: STARRED_FILE_VERSION,
        exportedAt: exportedAt.toISOString(),
        games: games.map(game => ({romName: game.romName, name: game.name})),
    }, null, 2) + '\n';
}

/**
 * The rom names of an export file (each once), from an untrusted upload. Throws an Error whose
 * message the BO shows when the file is not one.
 */
export function parseStarredFile(text: string): string[] {
    let content: unknown;
    try {
        content = JSON.parse(text);
    } catch {
        throw new Error('This file is not JSON.');
    }
    const file = content as {format?: unknown; games?: unknown};
    if (!file || typeof file !== 'object' || file.format !== STARRED_FILE_FORMAT || !Array.isArray(file.games)) {
        throw new Error('This file is not a "My favourites" export.');
    }
    if (file.games.length > MAX_STARRED_GAMES) {
        throw new Error(`Too many games in this file (${MAX_STARRED_GAMES} at most).`);
    }
    const romNames = file.games.map(game => (game as {romName?: unknown})?.romName);
    if (!romNames.every((romName): romName is string => typeof romName === 'string' && ROM_NAME.test(romName))) {
        throw new Error('This file holds a game without a valid rom name.');
    }
    return [...new Set(romNames)];
}
