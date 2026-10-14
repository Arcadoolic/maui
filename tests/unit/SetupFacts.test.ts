import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'fs';
import {join} from 'path';
import {tmpdir} from 'os';
import Config from '@/class/Config.class';
import {readSetupFacts} from '@/class/SetupFacts';
import {getDisabledRequiredPlugins} from '@/class/MameLocations';

let home: string;
let mameDir: string;

function plugin(name: string, start: boolean): void {
    mkdirSync(join(home, 'plugins', name), {recursive: true});
    writeFileSync(join(home, 'plugins', name, 'plugin.json'), JSON.stringify({
        plugin: {name, type: 'plugin', start: start ? 'true' : 'false'},
    }));
}

function config(): Config {
    // Never loaded nor saved: only its fields are read.
    const result = Object.create(Config.prototype) as Config;
    result.mamePath = mameDir;
    result.mameBinaryName = 'mame';
    result.setupOffline = false;
    return result;
}

beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'maui-setup-home-'));
    mameDir = mkdtempSync(join(tmpdir(), 'maui-setup-bin-'));
});

afterEach(() => {
    rmSync(home, {recursive: true, force: true});
    rmSync(mameDir, {recursive: true, force: true});
});

describe('readSetupFacts', () => {
    it('reads a bare mame home as nothing done', () => {
        const facts = readSetupFacts({config: config(), mameHomePath: home, passwordChanged: false, onlineConfigured: false});
        expect(facts).toEqual({
            passwordChanged: false,
            mameReady: false,
            missingPlugins: [],
            disabledRequiredPlugins: ['hiscore'],
            pluginsFound: false,
            onlineConfigured: false,
            offlineChosen: false,
            missingConfPackFiles: ['catver.ini', 'genre.ini', 'Multiplayer.ini'],
            favoritesCount: 0,
        });
    });

    it('reads a mame home set up', () => {
        writeFileSync(join(mameDir, 'mame'), '');
        writeFileSync(join(home, 'mame.ini'), 'pluginspath               plugins\n');
        writeFileSync(join(home, 'ui.ini'), 'categorypath              folders\nui_path                   ui\n');
        plugin('hiscore', false);
        plugin('autofire', false);
        writeFileSync(join(home, 'plugin.ini'), 'hiscore                   1\nautofire                  0\n');
        mkdirSync(join(home, 'folders'));
        for (const file of ['catver.ini', 'genre.ini', 'Multiplayer.ini']) {
            writeFileSync(join(home, 'folders', file), '');
        }
        mkdirSync(join(home, 'ui'));
        writeFileSync(join(home, 'ui', 'favorites.ini'), '[ROOT_FOLDER]\n[Favorites]\n\npacman\n\ngalaga\n');

        const facts = readSetupFacts({config: config(), mameHomePath: home, passwordChanged: true, onlineConfigured: true});
        expect(facts).toMatchObject({
            mameReady: true,
            missingPlugins: [],
            disabledRequiredPlugins: [],
            pluginsFound: true,
            missingConfPackFiles: [],
            favoritesCount: 2,
        });
    });

    it('lists the plugins found but missing from plugin.ini', () => {
        writeFileSync(join(home, 'mame.ini'), 'pluginspath               plugins\n');
        plugin('hiscore', false);
        plugin('autofire', false);
        writeFileSync(join(home, 'plugin.ini'), 'hiscore                   1\n');
        expect(readSetupFacts({config: config(), mameHomePath: home, passwordChanged: true, onlineConfigured: false})
            .missingPlugins).toEqual(['autofire']);
    });
});

describe('getDisabledRequiredPlugins', () => {
    it('wants hiscore at 1', () => {
        const ini = join(home, 'plugin.ini');
        expect(getDisabledRequiredPlugins(ini)).toEqual(['hiscore']);
        writeFileSync(ini, 'hiscore                   0\n');
        expect(getDisabledRequiredPlugins(ini)).toEqual(['hiscore']);
        writeFileSync(ini, 'hiscore                   1\n');
        expect(getDisabledRequiredPlugins(ini)).toEqual([]);
    });
});
