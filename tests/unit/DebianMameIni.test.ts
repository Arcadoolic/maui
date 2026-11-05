import {mkdtempSync, readFileSync, existsSync, writeFileSync} from 'fs';
import {tmpdir} from 'os';
import {join} from 'path';
import {describe, it, expect} from 'vitest';
import {adoptMameHomeLayout, isDebianMameIni, rewriteDebianMameIni} from '@/class/DebianMameIni';

// The head of /usr/lib/mame/mame.ini.default, mame 0.289+dfsg1-1~bpo13+1 (maui-cabinets' build).
const DEBIAN = `#
# CORE SEARCH PATH OPTIONS
#
# Default data search paths
rompath                 $HOME/mame/roms;/usr/local/share/games/mame/roms;/usr/share/games/mame/roms
samplepath              $HOME/mame/samples;/usr/local/share/games/mame/samples;/usr/share/games/mame/samples
artpath                 $HOME/mame/artwork;/usr/local/share/games/mame/artwork;/usr/share/games/mame/artwork
crosshairpath           $HOME/mame/crosshair;/usr/local/share/games/mame/crosshair;/usr/share/games/mame/crosshair
hashpath                /usr/share/games/mame/hash
ctrlrpath               /usr/share/games/mame/ctrlr
pluginspath             /usr/share/games/mame/plugins
cheatpath               $HOME/mame/cheat
homepath                $HOME/.mame
cfg_directory           $HOME/.mame/cfg
`;

describe('isDebianMameIni', () => {
    it('recognizes Debian\'s mame.ini by its rompath', () => {
        expect(isDebianMameIni(DEBIAN)).toBe(true);
        expect(isDebianMameIni('rompath                   roms\n')).toBe(false);
        expect(isDebianMameIni('')).toBe(false);
    });
});

describe('rewriteDebianMameIni', () => {
    it('puts ~/.mame first and keeps Debian\'s folders after it', () => {
        const {content, changed} = rewriteDebianMameIni(DEBIAN);
        expect(changed).toEqual(['rompath', 'samplepath', 'artpath', 'crosshairpath', 'cheatpath', 'ctrlrpath']);
        expect(content).toContain('rompath                 $HOME/.mame/roms;$HOME/mame/roms;/usr/local/share/games/mame/roms;/usr/share/games/mame/roms\n');
        expect(content).toContain('ctrlrpath               $HOME/.mame/ctrlr;/usr/share/games/mame/ctrlr\n');
        expect(content).toContain('cheatpath               $HOME/.mame/cheat;$HOME/mame/cheat\n');
        // System data mame needs stays where the package put it.
        expect(content).toContain('hashpath                /usr/share/games/mame/hash\n');
        expect(content).toContain('pluginspath             /usr/share/games/mame/plugins\n');
        expect(content).toContain('cfg_directory           $HOME/.mame/cfg\n');
    });

    it('changes nothing the second time', () => {
        const once = rewriteDebianMameIni(DEBIAN).content;
        expect(rewriteDebianMameIni(once)).toEqual({content: once, changed: []});
    });

    it('leaves any other mame.ini alone', () => {
        const own = 'rompath                   roms\nctrlrpath                 ctrlr\n';
        expect(rewriteDebianMameIni(own)).toEqual({content: own, changed: []});
    });
});

describe('adoptMameHomeLayout', () => {
    it('rewrites Debian\'s mame.ini and creates the folders now first', () => {
        const home = mkdtempSync(join(tmpdir(), 'maui-debian-ini-'));
        writeFileSync(join(home, 'mame.ini'), DEBIAN);
        expect(adoptMameHomeLayout(home)).toContain('rompath');
        expect(readFileSync(join(home, 'mame.ini'), 'utf8')).toContain('$HOME/.mame/roms;');
        expect(existsSync(join(home, 'roms'))).toBe(true);
        expect(existsSync(join(home, 'ctrlr'))).toBe(true);
        expect(adoptMameHomeLayout(home)).toEqual([]);
    });

    it('does nothing without a mame.ini', () => {
        expect(adoptMameHomeLayout(mkdtempSync(join(tmpdir(), 'maui-debian-ini-')))).toEqual([]);
    });
});
