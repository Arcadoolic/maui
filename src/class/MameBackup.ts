import {existsSync, readdirSync, statSync} from 'fs';
import {join, relative, isAbsolute, dirname} from 'path';
// Pinned (see package.json) to the last 0.5.x release - see boServer.ts's import of it.
import AdmZip from 'adm-zip';

// The light export of mame's own files (MAME tab > Import): its configuration and, if asked, the
// scores it keeps, never the roms nor any picture, sound or video. Every file keeps its path
// relative to the mame home (~/.mame) in the ZIP, so that unzipping it there puts it back.

export type MameBackupPartId = 'config' | 'scores';

/** Where mame keeps each kind of file, resolved from mame.ini and ui.ini by the caller. */
export interface MameBackupLocations {
    // cfg_directory (input mappings per game), ctrlrpath (controller files), ui.ini's ui_path
    // (favorites.ini) and categorypath (catver.ini, genre.ini, Multiplayer.ini).
    cfg: string;
    ctrlr: string;
    ui: string;
    categories: string;
    // The .hi files of the hiscore plugin, and nvram_directory (games saving their own scores).
    hiscore: string;
    nvram: string;
}

export const MAME_BACKUP_PARTS: readonly {id: MameBackupPartId; label: string}[] = [
    {id: 'config', label: 'Configuration: the .ini files, hiscore.dat, input mappings (cfg, ctrlr), favorites and categories'},
    {id: 'scores', label: 'Scores: the hiscore plugin\'s files and the games\' nvram'},
];

export function parseMameBackupParts(ids: readonly string[]): MameBackupPartId[] {
    return MAME_BACKUP_PARTS.filter(part => ids.includes(part.id)).map(part => part.id);
}

/** The files and folders the parts asked for are made of, those that exist. */
export function listMameBackupPaths(
    mameHome: string, partIds: readonly MameBackupPartId[], locations: MameBackupLocations,
): string[] {
    const paths: string[] = [];
    if (partIds.includes('config')) {
        if (existsSync(mameHome)) {
            // Every .ini at the root: mame.ini, ui.ini, plugin.ini, and the per-system ones
            // (vertical.ini, a game's own...).
            for (const name of readdirSync(mameHome).sort()) {
                if (name.toLowerCase().endsWith('.ini') && statSync(join(mameHome, name)).isFile()) {
                    paths.push(join(mameHome, name));
                }
            }
        }
        paths.push(join(mameHome, 'hiscore.dat'), locations.cfg, locations.ctrlr, locations.ui, locations.categories);
    }
    if (partIds.includes('scores')) {
        paths.push(locations.hiscore, locations.nvram);
    }
    return [...new Set(paths)].filter(path => existsSync(path));
}

/** Inside the mame home: what is elsewhere (a shared folder, the roms) has no place in the ZIP. */
function relativeInside(mameHome: string, path: string): string | null {
    const inside = relative(mameHome, path);
    return inside === '' || inside.startsWith('..') || isAbsolute(inside) ? null : inside;
}

/** The ZIP of those paths, null when there is nothing to put in it. */
export function buildMameBackup(mameHome: string, paths: readonly string[]): Buffer | null {
    const zip = new AdmZip();
    let count = 0;
    const add = (path: string) => {
        const inside = relativeInside(mameHome, path);
        if (inside === null) {
            return;
        }
        if (statSync(path).isDirectory()) {
            readdirSync(path).sort().forEach(name => add(join(path, name)));
            return;
        }
        const folder = dirname(inside);
        zip.addLocalFile(path, folder === '.' ? '' : folder.split('\\').join('/'));
        count++;
    };
    paths.forEach(add);
    return count === 0 ? null : zip.toBuffer();
}
