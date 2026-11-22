import {afterEach, beforeEach, describe, expect, it} from 'vitest';
import {mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'fs';
import {tmpdir} from 'os';
import {join} from 'path';
import {missingPackPlugins, packPluginsArgs, packPluginsDir, pluginsInPack, registerPackPlugins} from '@/class/PackPlugins';

function installPlugin(home: string, name: string): void {
    const dir = join(packPluginsDir(home), name);
    mkdirSync(dir, {recursive: true});
    writeFileSync(join(dir, 'plugin.json'), JSON.stringify({plugin: {name, type: 'plugin', start: 'false'}}));
    writeFileSync(join(dir, 'init.lua'), 'return {}');
}

describe('PackPlugins', () => {
    let home: string;

    beforeEach(() => {
        home = mkdtempSync(join(tmpdir(), 'maui-packplugins-'));
    });

    afterEach(() => rmSync(home, {recursive: true, force: true}));

    it('names the plugins a pack holds by their plugin.json', () => {
        expect(pluginsInPack([
            'hiscore.dat', 'folders/genre.ini', 'plugins/movelist/plugin.json', 'plugins/movelist/init.lua',
            'plugins/movelist/games/mk2.json', 'plugins/other/games/plugin.json',
        ])).toEqual(['movelist']);
    });

    it('says which plugins of the pack are not installed', () => {
        const files = ['plugins/movelist/plugin.json', 'plugins/movelist/init.lua'];
        expect(missingPackPlugins(home, files)).toEqual(['movelist']);
        installPlugin(home, 'movelist');
        expect(missingPackPlugins(home, files)).toEqual([]);
        expect(missingPackPlugins(home, ['hiscore.dat'])).toEqual([]);
    });

    it('switches the pack plugins on in plugin.ini, leaving one switched off by hand alone', () => {
        writeFileSync(join(home, 'plugin.ini'), 'hiscore                    1\n');
        installPlugin(home, 'movelist');
        expect(registerPackPlugins(home)).toBe(1);
        expect(readFileSync(join(home, 'plugin.ini'), 'utf8')).toMatch(/^movelist\s+1$/m);

        writeFileSync(join(home, 'plugin.ini'), 'hiscore                    1\nmovelist                   0\n');
        expect(registerPackPlugins(home)).toBe(0);
        expect(readFileSync(join(home, 'plugin.ini'), 'utf8')).toMatch(/^movelist\s+0$/m);
    });

    it('adds nothing to the command line before the pack brought a plugin', () => {
        writeFileSync(join(home, 'mame.ini'), 'pluginspath                /usr/share/games/mame/plugins\n');
        expect(packPluginsArgs(home)).toEqual([]);
    });

    it('puts the pack plugins after the folders of mame.ini', () => {
        writeFileSync(join(home, 'mame.ini'), 'pluginspath                /usr/share/games/mame/plugins;extra\n');
        installPlugin(home, 'movelist');
        expect(packPluginsArgs(home)).toEqual([
            '-pluginspath', ['/usr/share/games/mame/plugins', join(home, 'extra'), packPluginsDir(home)].join(';'),
        ]);
    });

    it('keeps MAME\'s default plugins folder when mame.ini names none', () => {
        installPlugin(home, 'movelist');
        expect(packPluginsArgs(home)).toEqual(['-pluginspath', `${join(home, 'plugins')};${packPluginsDir(home)}`]);
    });
});
