import {existsSync, readdirSync, readFileSync} from 'fs';
import {join} from 'path';
import {getAvailablePlugins, repairPluginIni, resolveDirectoryPath} from '@/class/MameLocations';
import {parseMameIni} from '@/class/MameIniParser';

/**
 * MAME plugins MAUI installs itself, from the configuration pack's `plugins/` folder (ConfPack.ts):
 * the move list of fighting games (maui-movelist) to start with. They go in `maui-plugins/` in the
 * mame home, never in MAME's own plugins folder (root's on Debian, replaced by a MAME update), and
 * reach MAME through the command line of the games the front launches (`packPluginsArgs()`):
 * mame.ini's pluginspath stays what the BO and the setup guide show and write.
 *
 * Republishing the configuration pack is enough to update them on every ONLINE cabinet
 * (ConfPackUpdate.ts): no MAUI release.
 */

export const PACK_PLUGINS_FOLDER = 'plugins';

/** Where the pack's plugins are installed: next to hiscore.dat, in the mame home. */
export function packPluginsDir(mameHome: string): string {
    return join(mameHome, 'maui-plugins');
}

/** Names of the plugin folders a pack's files hold (`plugins/<name>/plugin.json`). */
export function pluginsInPack(fileNames: readonly string[]): string[] {
    return fileNames
        .map(name => /^plugins\/([^/]+)\/plugin\.json$/.exec(name)?.[1])
        .filter((name): name is string => !!name);
}

/** Plugins of the pack that are not installed in the mame home: the pack must be installed again. */
export function missingPackPlugins(mameHome: string, fileNames: readonly string[]): string[] {
    const dir = packPluginsDir(mameHome);
    return pluginsInPack(fileNames).filter(name => !existsSync(join(dir, name, 'plugin.json')));
}

/**
 * Lists the pack's plugins in plugin.ini, switched on: MAME only runs a plugin plugin.ini starts.
 * A plugin already listed is left as it is, so one switched off by hand stays off. Returns how
 * many were added.
 */
export function registerPackPlugins(mameHome: string): number {
    const plugins = getAvailablePlugins(packPluginsDir(mameHome)).map(plugin => ({...plugin, defaultStart: true}));
    return plugins.length ? repairPluginIni(join(mameHome, 'plugin.ini'), plugins) : 0;
}

/**
 * `-pluginspath` for a game: mame.ini's folders (MAME's own first: a plugin of the pack may need
 * its libraries, json for one), then the pack's. Nothing when the pack brought no plugin.
 */
export function packPluginsArgs(mameHome: string): string[] {
    const dir = packPluginsDir(mameHome);
    if (!existsSync(dir) || !readdirSync(dir).length) {
        return [];
    }
    const mameIni = join(mameHome, 'mame.ini');
    const configured = (existsSync(mameIni) ? parseMameIni(readFileSync(mameIni, 'utf8')).pluginspath ?? [] : [])
        .map(path => path.trim()).filter(Boolean);
    // MAME's own default when mame.ini names none, relative to its current directory: the mame home.
    const paths = (configured.length ? configured : ['plugins']).map(path => resolveDirectoryPath(path, mameHome));
    return ['-pluginspath', [...paths.filter(path => path !== dir), dir].join(';')];
}
