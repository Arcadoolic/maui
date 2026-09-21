import {describe, it, expect} from 'vitest';
import {canRestartKiosk, restartKiosk} from '@/class/KioskRestart';

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
