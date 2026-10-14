import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync} from 'fs';
import {join} from 'path';
import {tmpdir} from 'os';
import AdmZip from 'adm-zip';
import {buildBackup, deleteBackupParts, parseBackupParts, restoreBackup} from '@/class/MauiBackup';

const SQLITE = Buffer.concat([Buffer.from('SQLite format 3\0'), Buffer.alloc(16)]);

let source: string;
let target: string;

function fill(dir: string): void {
    writeFileSync(join(dir, 'mame-awesome-ui-config.json'), '{"mamePath":"/opt/mame"}');
    writeFileSync(join(dir, 'removed-favorites.json'), '["pacman"]');
    writeFileSync(join(dir, 'mame-awesome-ui.sqlite'), SQLITE);
    writeFileSync(join(dir, 'avatar-sync.json'), '{}');
    writeFileSync(join(dir, 'favorites-cache.json'), '{}');
    writeFileSync(join(dir, 'roms-infos-cache.json'), '{}');
    writeFileSync(join(dir, 'online.json'), '{"token":"secret"}');
    mkdirSync(join(dir, 'avatars'));
    writeFileSync(join(dir, 'avatars', 'aaa.png'), 'png');
    mkdirSync(join(dir, 'online-avatars'));
    writeFileSync(join(dir, 'online-avatars', 'bbb.png'), 'png');
    // Not the application's: never exported.
    writeFileSync(join(dir, 'online.json.staging-backup'), '{}');
}

function entries(zip: Buffer): string[] {
    return new AdmZip(zip).getEntries().map(entry => entry.entryName).sort();
}

beforeEach(() => {
    source = mkdtempSync(join(tmpdir(), 'maui-backup-source-'));
    target = mkdtempSync(join(tmpdir(), 'maui-backup-target-'));
});

afterEach(() => {
    rmSync(source, {recursive: true, force: true});
    rmSync(target, {recursive: true, force: true});
});

describe('MauiBackup', () => {
    it('keeps only the known parts, in their own order', () => {
        expect(parseBackupParts(['online', 'nope', 'config'])).toEqual(['config', 'online']);
    });

    it('exports every file of the parts asked for, and only those', () => {
        fill(source);
        expect(entries(buildBackup(source, ['config', 'database', 'caches'])!)).toEqual([
            'avatar-sync.json',
            'avatars/aaa.png',
            'favorites-cache.json',
            'mame-awesome-ui-config.json',
            'mame-awesome-ui.sqlite',
            'online-avatars/bbb.png',
            'removed-favorites.json',
            'roms-infos-cache.json',
        ]);
        expect(entries(buildBackup(source, ['online'])!)).toEqual(['online.json']);
    });

    it('has nothing to export when none of the files exists', () => {
        expect(buildBackup(source, ['config', 'database'])).toBeNull();
    });

    it('restores what it exported, the private files owner-only', () => {
        fill(source);
        const parts = restoreBackup(target, buildBackup(source, ['config', 'database', 'caches', 'online'])!);

        expect(parts.map(part => part.id)).toEqual(['config', 'database', 'caches', 'online']);
        expect(readFileSync(join(target, 'online.json'), 'utf8')).toBe('{"token":"secret"}');
        expect(readFileSync(join(target, 'avatars', 'aaa.png'), 'utf8')).toBe('png');
        expect(readFileSync(join(target, 'mame-awesome-ui.sqlite'))).toEqual(SQLITE);
        if (process.platform !== 'win32') {
            expect(statSync(join(target, 'online.json')).mode & 0o777).toBe(0o600);
            expect(statSync(join(target, 'mame-awesome-ui-config.json')).mode & 0o777).toBe(0o600);
        }
    });

    it('replaces a directory it holds, and leaves alone the files it does not hold', () => {
        fill(source);
        mkdirSync(join(target, 'avatars'));
        writeFileSync(join(target, 'avatars', 'old.png'), 'old');
        writeFileSync(join(target, 'online.json'), '{"token":"mine"}');

        restoreBackup(target, buildBackup(source, ['database'])!);

        expect(readdirSync(join(target, 'avatars'))).toEqual(['aaa.png']);
        expect(readFileSync(join(target, 'online.json'), 'utf8')).toBe('{"token":"mine"}');
    });

    it('reads a ZIP of an older MAUI, its files in a folder, and keeps the avatars it does not hold', () => {
        mkdirSync(join(target, 'avatars'));
        writeFileSync(join(target, 'avatars', 'kept.png'), 'kept');
        const zip = new AdmZip();
        zip.addFile('export/mame-awesome-ui-config.json', Buffer.from('{}'));
        zip.addFile('export/mame-awesome-ui.sqlite', SQLITE);

        expect(restoreBackup(target, zip.toBuffer()).map(part => part.id)).toEqual(['config', 'database']);
        expect(existsSync(join(target, 'mame-awesome-ui-config.json'))).toBe(true);
        expect(readdirSync(join(target, 'avatars'))).toEqual(['kept.png']);
    });

    it('writes nothing an entry would place elsewhere, nor anything it does not know', () => {
        const zip = new AdmZip();
        zip.addFile('notes.txt', Buffer.from('?'));
        zip.addFile('other/aaa.png', Buffer.from('png'));

        expect(restoreBackup(target, zip.toBuffer())).toEqual([]);
        expect(readdirSync(target)).toEqual([]);
    });

    it('refuses a damaged file before writing any', () => {
        const zip = new AdmZip();
        zip.addFile('removed-favorites.json', Buffer.from('[]'));
        zip.addFile('mame-awesome-ui.sqlite', Buffer.from('not a database'));

        expect(() => restoreBackup(target, zip.toBuffer())).toThrow('valid sqlite');
        expect(readdirSync(target)).toEqual([]);

        const json = new AdmZip();
        json.addFile('mame-awesome-ui-config.json', Buffer.from('{oops'));
        expect(() => restoreBackup(target, json.toBuffer())).toThrow('not valid JSON');
    });
});

describe('deleteBackupParts', () => {
    it('deletes every file of the parts given, and only those', () => {
        fill(source);
        const deleted = deleteBackupParts(source, ['config', 'database']);

        expect(deleted.map(part => part.id)).toEqual(['config', 'database']);
        expect(readdirSync(source).sort()).toEqual([
            'favorites-cache.json', 'online.json', 'online.json.staging-backup', 'roms-infos-cache.json',
        ]);
    });

    it('says nothing was deleted when a part has no file', () => {
        expect(deleteBackupParts(source, ['online'])).toEqual([]);
    });
});
