import {existsSync, readdirSync} from 'fs';
import {join} from 'path';
import {packPluginsDir} from '@/class/PackPlugins';

/**
 * The games whose special moves maui-movelist's MAME plugin shows during the game (one base per
 * game, `games/<rom>.json`, installed from the configuration pack in the mame home's
 * maui-plugins/, PackPlugins.ts): the front marks them (Games.vue's badge, LaunchStage.vue's line).
 * Read from the installed plugin, so a game added to it reaches the cabinets with the pack alone.
 */
export function loadMoveListGames(mameHome: string): Set<string> {
    const dir = join(packPluginsDir(mameHome), 'movelist', 'games');
    try {
        return new Set(existsSync(dir)
            ? readdirSync(dir).filter(name => /^[a-z0-9_]+\.json$/.test(name)).map(name => name.slice(0, -'.json'.length))
            : []);
    } catch {
        return new Set();
    }
}
