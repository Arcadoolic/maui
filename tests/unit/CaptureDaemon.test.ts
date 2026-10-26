import {afterEach, beforeEach, describe, it, expect} from 'vitest';
import {existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync} from 'fs';
import {basename, dirname, join} from 'path';
import os from 'os';
import {captureDirFromArgs, captureLaunchArgs, listSessionReports, prepareCaptureDir} from '@/class/CaptureDaemon';

describe('prepareCaptureDir', () => {
    let publicDir: string;
    let root: string;

    beforeEach(() => {
        publicDir = mkdtempSync(join(os.tmpdir(), 'maui-public-'));
        root = mkdtempSync(join(os.tmpdir(), 'maui-captures-'));
        mkdirSync(join(publicDir, 'lua'));
        writeFileSync(join(publicDir, 'lua', 'capture-daemon.lua'), 'local CAPTURE_DIR = [[__CAPTURE_DIR__]]\n');
    });

    afterEach(() => {
        rmSync(publicDir, {recursive: true, force: true});
        rmSync(root, {recursive: true, force: true});
    });

    it('writes the script into a fresh directory named after the game, pointed at that directory', () => {
        const {dir, scriptPath} = prepareCaptureDir(publicDir, 'mslug', root, new Date(2026, 9, 26, 10, 15, 0));

        expect(dirname(scriptPath)).toBe(dir);
        expect(dirname(dir)).toBe(root);
        expect(basename(dir)).toMatch(/^mslug-20261026-101500-[A-Za-z0-9]{6}$/);
        expect(readFileSync(scriptPath, 'utf8')).toBe(`local CAPTURE_DIR = [[${dir}]]\n`);
    });

    it('gives every launch its own directory', () => {
        const now = new Date(2026, 9, 26, 10, 15, 0);

        expect(prepareCaptureDir(publicDir, 'mslug', root, now).dir).not.toBe(prepareCaptureDir(publicDir, 'mslug', root, now).dir);
    });

    it('deletes the directories of more than 7 days', () => {
        const old = prepareCaptureDir(publicDir, 'mslug', root, new Date(2026, 9, 1)).dir;
        utimesSync(old, new Date(2026, 9, 1), new Date(2026, 9, 1));

        prepareCaptureDir(publicDir, 'dkong', root, new Date(2026, 9, 26));

        expect(existsSync(old)).toBe(false);
    });
});

describe('listSessionReports', () => {
    let root: string;

    beforeEach(() => {
        root = mkdtempSync(join(os.tmpdir(), 'maui-captures-'));
    });

    afterEach(() => {
        rmSync(root, {recursive: true, force: true});
    });

    function session(name: string, modified: Date): void {
        mkdirSync(join(root, name));
        writeFileSync(join(root, name, 'session-report.json'), '{}');
        utimesSync(join(root, name, 'session-report.json'), modified, modified);
    }

    it('lists the reports of the game, newest first, not those of a game with a longer name', () => {
        session('mslug-20261025-164200-aB3dE9', new Date(2026, 9, 25, 17, 21));
        session('mslug-20261025-172142-Zz9yX8', new Date(2026, 9, 25, 17, 21, 59));
        session('mslug2-20261025-180000-Qq1wE2', new Date(2026, 9, 25, 18, 30));
        mkdirSync(join(root, 'mslug-20261026-090000-noRprt'));

        expect(listSessionReports('mslug', root).map(report => report.name))
            .toEqual(['mslug-20261025-172142-Zz9yX8', 'mslug-20261025-164200-aB3dE9']);
    });

    it('has nothing to list before the first game', () => {
        expect(listSessionReports('mslug', join(root, 'none'))).toEqual([]);
    });
});

describe('captureDirFromArgs', () => {
    it('finds the directory of the capture script MAME was launched with', () => {
        const args = ['-skip_gameinfo', 'pacman', ...captureLaunchArgs('/tmp/maui-capture-x/capture-daemon.lua'), '-inipath', '/home/a/.mame'];

        expect(captureDirFromArgs(args)).toBe('/tmp/maui-capture-x');
    });

    it('ignores a MAME launched without it, or with another script', () => {
        expect(captureDirFromArgs(['-skip_gameinfo', 'pacman'])).toBeUndefined();
        expect(captureDirFromArgs(['-autoboot_script', '/tmp/other.lua'])).toBeUndefined();
        expect(captureDirFromArgs(['-autoboot_script'])).toBeUndefined();
    });
});

describe('captureLaunchArgs', () => {
    it('runs the script with background input, so captures work while the BO has the focus', () => {
        const args = captureLaunchArgs('/tmp/d/capture-daemon.lua');

        expect(args).toContain('-background_input');
        expect(args[args.indexOf('-autoboot_script') + 1]).toBe('/tmp/d/capture-daemon.lua');
    });
});
