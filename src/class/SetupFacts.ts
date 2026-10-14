import {existsSync, readFileSync} from 'fs';
import {join} from 'path';
import type Config from '@/class/Config.class';
import {getMissingConfPackFiles} from '@/class/ConfPack';
import {parseFavorites} from '@/class/MameIniParser';
import {
    getAvailablePlugins, getDisabledRequiredPlugins, getMameIniValue, getMameLocations, getMissingPlugins,
    resolveDirectoryPath,
} from '@/class/MameLocations';
import type {SetupFacts} from '@/class/SetupSteps';

// What the setup guide (SetupSteps.ts) is told of the cabinet, read from the files: by the BO,
// and by the main process for the cabinet's screen while the BO is not loaded. Never runs mame:
// the cabinet's screen asks every few seconds.

export interface SetupFactsInput {
    config: Config;
    // ~/.mame, where mame runs from and keeps its ini files.
    mameHomePath: string;
    // Read from the database by the caller (bo_user.secretsKey).
    passwordChanged: boolean;
    // A configuration string was pasted (OnlineSetup.ts onlineIndicator() is not null).
    onlineConfigured: boolean;
}

export function readSetupFacts(input: SetupFactsInput): SetupFacts {
    const {config, mameHomePath} = input;
    const mameIniPath = join(mameHomePath, 'mame.ini');
    const pluginIniPath = join(mameHomePath, 'plugin.ini');
    const pluginsPath = getMameIniValue(mameIniPath, 'pluginspath');
    const plugins = getAvailablePlugins(pluginsPath ? resolveDirectoryPath(pluginsPath, mameHomePath) : null);
    const locations = getMameLocations(mameHomePath);
    const favorites = locations.favoritesPath && existsSync(locations.favoritesPath)
        ? parseFavorites(readFileSync(locations.favoritesPath, 'utf8'))
        : [];
    return {
        passwordChanged: input.passwordChanged,
        mameReady: config.mamePath !== '' && config.mameBinaryName !== ''
            && existsSync(join(config.mamePath, config.mameBinaryName)),
        missingPlugins: getMissingPlugins(pluginIniPath, plugins),
        disabledRequiredPlugins: getDisabledRequiredPlugins(pluginIniPath),
        pluginsFound: plugins.length > 0,
        onlineConfigured: input.onlineConfigured,
        offlineChosen: config.setupOffline,
        missingConfPackFiles: getMissingConfPackFiles(locations),
        favoritesCount: favorites.length,
    };
}
