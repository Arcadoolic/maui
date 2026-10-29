import {describe, it, expect} from 'vitest';
import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'fs';
import {tmpdir} from 'os';
import {join} from 'path';
import {canRestartKiosk, isKioskLayout, powerOff, restartKiosk} from '@/class/KioskRestart';

describe('canRestartKiosk', () => {
    it('runs the rule\'s harmless reset-failed through sudo -n, which cannot prompt', async () => {
        let call: {file: string; args: string[]} | undefined;
        const allowed = await canRestartKiosk((file, args, _options, callback) => {
            call = {file, args};
            callback(null);
        });

        expect(allowed).toBe(true);
        expect(call).toEqual({
            file: 'sudo',
            args: ['-n', '/usr/bin/systemctl', 'reset-failed', 'getty@tty1'],
        });
    });

    it('is false when sudo refuses (no rule, or a password would be needed) or is missing', async () => {
        expect(await canRestartKiosk((_file, _args, _options, callback) => callback(new Error('exit 1')))).toBe(false);
        expect(await canRestartKiosk((_file, _args, _options, callback) => callback(
            Object.assign(new Error('spawn sudo ENOENT'), {code: 'ENOENT'}),
        ))).toBe(false);
    });
});

describe('restartKiosk', () => {
    it('runs the restart through sudo -n, detached, and does not wait for it', () => {
        let call: {command: string; args: string[]; detached: boolean} | undefined;
        let unref = false;
        restartKiosk((command, args, options) => {
            call = {command, args, detached: options.detached};
            return {unref: () => { unref = true; }};
        });

        expect(call).toEqual({
            command: 'sudo',
            args: ['-n', '/usr/bin/systemctl', 'restart', 'getty@tty1'],
            detached: true,
        });
        expect(unref).toBe(true);
    });
});

describe('isKioskLayout', () => {
    it('is a packaged Linux application next to an extracted ~/squashfs-root', () => {
        const home = mkdtempSync(join(tmpdir(), 'maui-kiosk-'));
        try {
            expect(isKioskLayout(true, 'linux', home)).toBe(false);
            mkdirSync(join(home, 'squashfs-root'));
            writeFileSync(join(home, 'squashfs-root', 'AppRun'), '');
            expect(isKioskLayout(true, 'linux', home)).toBe(true);
            expect(isKioskLayout(false, 'linux', home)).toBe(false);
            expect(isKioskLayout(true, 'win32', home)).toBe(false);
        } finally {
            rmSync(home, {recursive: true, force: true});
        }
    });
});

describe('powerOff', () => {
    it('powers off through the sudo rule first', async () => {
        const calls: string[] = [];
        const refused = await powerOff((file, args, _options, callback) => {
            calls.push([file, ...args].join(' '));
            callback(null);
        });
        expect(refused).toBeNull();
        expect(calls).toEqual(['sudo -n /usr/bin/systemctl poweroff']);
    });

    it('falls back on systemd\'s own permission without the rule', async () => {
        const calls: string[] = [];
        const refused = await powerOff((file, args, _options, callback) => {
            calls.push([file, ...args].join(' '));
            callback(file === 'sudo' ? new Error('a password is required') : null);
        });
        expect(refused).toBeNull();
        expect(calls).toEqual(['sudo -n /usr/bin/systemctl poweroff', '/usr/bin/systemctl poweroff']);
    });

    it('says why when neither is allowed', async () => {
        const refused = await powerOff((_file, _args, _options, callback) => callback(new Error('denied')));
        expect(refused).toMatch(/Not allowed to shut the cabinet down/);
    });
});
