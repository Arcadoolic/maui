/**
 * The configuration pack: a game-free zip published at the root of the pack repository, holding
 * only a `folders/` directory with the category datasets the carousel is built from (catver.ini,
 * genre.ini, Multiplayer.ini - see GameService). Game packs no longer ship these files: the BO
 * installs this pack before any game pack import from the repository, and keeps the game pack
 * list locked until it is installed.
 */

export const CONF_PACK_FILENAME = 'mame-conf-pack.zip';

/** Where each required file of the pack is found, null when missing (see MameInfo). */
export interface ConfPackPaths {
    catverIniPath: string | null;
    genreIniPath: string | null;
    nplayersIniPath: string | null;
}

/** Names of the files of the configuration pack not installed in categorypath yet. */
export function getMissingConfPackFiles(paths: ConfPackPaths): string[] {
    return ([
        ['catver.ini', paths.catverIniPath],
        ['genre.ini', paths.genreIniPath],
        ['Multiplayer.ini', paths.nplayersIniPath],
    ] as const).filter(([, path]) => !path).map(([name]) => name);
}

/** The repository's index lists every zip it holds: the configuration pack is not a game pack. */
export function isGamePack(filename: string): boolean {
    return filename !== CONF_PACK_FILENAME;
}
