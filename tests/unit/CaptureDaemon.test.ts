import {afterEach, beforeEach, describe, it, expect} from 'vitest';
import {mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'fs';
import {dirname, join} from 'path';
import os from 'os';
import {captureDirFromArgs, captureLaunchArgs, prepareCaptureDir} from '@/class/CaptureDaemon';

describe('prepareCaptureDir', () => {
    let publicDir: string;

    beforeEach(() => {
        publicDir = mkdtempSync(join(os.tmpdir(), 'maui-public-'));
        mkdirSync(join(publicDir, 'lua'));
        writeFileSync(join(publicDir, 'lua', 'capture-daemon.lua'), 'local CAPTURE_DIR = [[__CAPTURE_DIR__]]\n');
    });

    afterEach(() => {
        rmSync(publicDir, {recursive: true, force: true});
    });

    it('writes the script into a fresh directory, pointed at that directory', () => {
        const {dir, scriptPath} = prepareCaptureDir(publicDir);

        expect(dirname(scriptPath)).toBe(dir);
        expect(readFileSync(scriptPath, 'utf8')).toBe(`local CAPTURE_DIR = [[${dir}]]\n`);
        rmSync(dir, {recursive: true, force: true});
    });

    it('gives every launch its own directory', () => {
        const first = prepareCaptureDir(publicDir);
        const second = prepareCaptureDir(publicDir);

        expect(first.dir).not.toBe(second.dir);
        rmSync(first.dir, {recursive: true, force: true});
        rmSync(second.dir, {recursive: true, force: true});
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
