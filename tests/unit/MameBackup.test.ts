import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'fs';
import {join} from 'path';
import {tmpdir} from 'os';
import AdmZip from 'adm-zip';
import {buildMameBackup, listMameBackupPaths, parseMameBackupParts, type MameBackupLocations} from '@/class/MameBackup';

let home: string;
let outside: string;
let locations: MameBackupLocations;

function file(path: string, content = 'x'): void {
    mkdirSync(join(path, '..'), {recursive: true});
    writeFileSync(path, content);
}

function entries(zip: Buffer | null): string[] {
    return zip ? new AdmZip(zip).getEntries().map(entry => entry.entryName).sort() : [];
}

beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'mame-backup-home-'));
    outside = mkdtempSync(join(tmpdir(), 'mame-backup-outside-'));
    locations = {
        cfg: join(home, 'cfg'), ctrlr: join(home, 'ctrlr'), ui: join(home, 'ui'), categories: join(home, 'folders'),
        hiscore: join(home, 'hiscore'), nvram: join(home, 'nvram'),
    };
    file(join(home, 'mame.ini'));
    file(join(home, 'ui.ini'));
    file(join(home, 'plugin.ini'));
    file(join(home, 'vertical.ini'));
    file(join(home, 'hiscore.dat'));
    file(join(home, 'cfg', 'default.cfg'));
    file(join(home, 'cfg', 'pacman.cfg'));
    file(join(home, 'ctrlr', 'cabinet.cfg'));
    file(join(home, 'ui', 'favorites.ini'));
    file(join(home, 'folders', 'genre.ini'));
    file(join(home, 'hiscore', 'pacman.hi'));
    file(join(home, 'nvram', 'robotron', 'nvram'));
    // Never exported.
    file(join(home, 'roms', 'pacman.zip'));
    file(join(home, 'marquees', 'pacman.png'));
    file(join(home, 'snap', 'pacman', '0000.png'));
    file(join(home, 'samples', 'invaders.zip'));
});

afterEach(() => {
    rmSync(home, {recursive: true, force: true});
    rmSync(outside, {recursive: true, force: true});
});

describe('MameBackup', () => {
    it('keeps only the known parts', () => {
        expect(parseMameBackupParts(['scores', 'roms'])).toEqual(['scores']);
    });

    it('exports the configuration and the scores, never the games nor their pictures', () => {
        expect(entries(buildMameBackup(home, listMameBackupPaths(home, ['config', 'scores'], locations)))).toEqual([
            'cfg/default.cfg',
            'cfg/pacman.cfg',
            'ctrlr/cabinet.cfg',
            'folders/genre.ini',
            'hiscore.dat',
            'hiscore/pacman.hi',
            'mame.ini',
            'nvram/robotron/nvram',
            'plugin.ini',
            'ui.ini',
            'ui/favorites.ini',
            'vertical.ini',
        ]);
    });

    it('exports one part alone', () => {
        expect(entries(buildMameBackup(home, listMameBackupPaths(home, ['scores'], locations)))).toEqual([
            'hiscore/pacman.hi',
            'nvram/robotron/nvram',
        ]);
    });

    it('leaves out a folder outside the mame home', () => {
        file(join(outside, 'cfg', 'default.cfg'));
        const paths = listMameBackupPaths(home, ['config'], {...locations, cfg: join(outside, 'cfg')});
        expect(entries(buildMameBackup(home, paths))).not.toContain('default.cfg');
        expect(entries(buildMameBackup(home, paths)).some(entry => entry.includes('..'))).toBe(false);
    });

    it('has nothing to export in an empty mame home', () => {
        const empty = mkdtempSync(join(tmpdir(), 'mame-backup-empty-'));
        try {
            expect(buildMameBackup(empty, listMameBackupPaths(empty, ['config', 'scores'], {
                cfg: join(empty, 'cfg'), ctrlr: join(empty, 'ctrlr'), ui: join(empty, 'ui'),
                categories: join(empty, 'folders'), hiscore: join(empty, 'hiscore'), nvram: join(empty, 'nvram'),
            }))).toBeNull();
        } finally {
            rmSync(empty, {recursive: true, force: true});
        }
    });
});
