import {existsSync, mkdirSync, readFileSync, writeFileSync} from 'fs';
import {join} from 'path';

// Debian's mame package (and the one maui-cabinets rebuilds for trixie) runs mame through
// /usr/games/mame, a script that copies /usr/lib/mame/mame.ini.default into ~/.mame before
// -createconfig ever runs. That mame.ini searches $HOME/mame/<kind> (no dot) then
// /usr/local/share/games/mame/<kind> and /usr/share/games/mame/<kind>, and the package ships
// /usr/share/games/mame/roms: on a machine set up by hand, $HOME/mame/roms does not exist, so the
// first existing roms folder (MameLocations.ensureFirstDirectory()) is the system's, where nothing
// can be written. Its ctrlrpath is /usr/share/games/mame/ctrlr only, where the BO cannot write its
// controller file either.
//
// adoptMameHomeLayout() puts ~/.mame/<kind> first in those paths, as mame's own -createconfig
// would, and keeps every folder Debian listed after it: roms already copied into $HOME/mame/roms
// (maui-cabinets' playbook creates it) are still found by mame.

// The search paths whose first entry must be a folder of the mame home, and its name there.
const SEARCH_PATHS: Record<string, string> = {
    rompath: 'roms',
    samplepath: 'samples',
    artpath: 'artwork',
    crosshairpath: 'crosshair',
    cheatpath: 'cheat',
    ctrlrpath: 'ctrlr',
};

const HOME_PREFIX = '$HOME/.mame/';

/** Debian's mame.ini, recognized by its rompath (the system folder no other mame.ini lists). */
export function isDebianMameIni(content: string): boolean {
    const rompath = /^rompath[ \t]+(\S+)/m.exec(content)?.[1] ?? '';
    return rompath.split(';').includes('/usr/share/games/mame/roms');
}

/**
 * The same mame.ini with ~/.mame/<kind> first in each search path, and the paths changed; the
 * content is returned as it is when it is not Debian's or already starts with ~/.mame.
 */
export function rewriteDebianMameIni(content: string): {content: string; changed: string[]} {
    if (!isDebianMameIni(content)) {
        return {content, changed: []};
    }
    const changed: string[] = [];
    let updated = content;
    for (const [key, folder] of Object.entries(SEARCH_PATHS)) {
        const lineRegex = new RegExp(`^(${key}[ \\t]+)(\\S+)`, 'm');
        updated = updated.replace(lineRegex, (line, keyAndSpacing: string, value: string) => {
            const entries = value.split(';');
            const wanted = HOME_PREFIX + folder;
            if (entries[0] === wanted) {
                return line;
            }
            changed.push(key);
            return keyAndSpacing + [wanted, ...entries.filter(entry => entry !== wanted)].join(';');
        });
    }
    return {content: updated, changed};
}

/**
 * Rewrites ~/.mame/mame.ini when it is Debian's (rewriteDebianMameIni()) and creates the folders
 * now first in its paths, so that they are the first existing ones. The keys changed, empty when
 * nothing was.
 */
export function adoptMameHomeLayout(mameHomePath: string): string[] {
    const mameIniPath = join(mameHomePath, 'mame.ini');
    if (!existsSync(mameIniPath)) {
        return [];
    }
    const {content, changed} = rewriteDebianMameIni(readFileSync(mameIniPath, 'utf8'));
    if (!changed.length) {
        return [];
    }
    writeFileSync(mameIniPath, content);
    for (const key of changed) {
        // The mame home is ~/.mame (Helpers.getMameHomePath()), what $HOME/.mame/ names in mame.ini.
        mkdirSync(join(mameHomePath, SEARCH_PATHS[key]), {recursive: true});
    }
    return changed;
}
