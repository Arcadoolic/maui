import {describe, it, expect, vi} from 'vitest';
import {canSwitchScreenOff, setScreenPower} from '@/class/ScreenPower';

vi.mock('@/class/KioskRestart', () => ({isKioskLayout: (isPackaged: boolean, platform: string) => isPackaged && platform === 'linux'}));

describe('canSwitchScreenOff', () => {
    it('only on the kiosk layout under X11', () => {
        expect(canSwitchScreenOff(true, {DISPLAY: ':0'}, 'linux')).toBe(true);
        expect(canSwitchScreenOff(false, {DISPLAY: ':0'}, 'linux')).toBe(false);
        expect(canSwitchScreenOff(true, {}, 'linux')).toBe(false);
        expect(canSwitchScreenOff(true, {DISPLAY: ':0', WAYLAND_DISPLAY: 'wayland-0'}, 'linux')).toBe(false);
    });
});

describe('setScreenPower', () => {
    const recorder = (fail = false) => {
        const calls: string[][] = [];
        const exec = (_file: string, args: string[], _options: unknown, callback: (error: Error | null) => void) => {
            calls.push(args);
            callback(fail ? new Error('xset: unable to open display') : null);
        };
        return {calls, exec};
    };

    it('switches the screen off', async () => {
        const {calls, exec} = recorder();
        await setScreenPower(false, exec);
        expect(calls).toEqual([['dpms', 'force', 'off']]);
    });

    it('switches it back on, then DPMS off again as the kiosk has it', async () => {
        const {calls, exec} = recorder();
        await setScreenPower(true, exec);
        expect(calls).toEqual([['dpms', 'force', 'on'], ['-dpms']]);
    });

    it('rejects with what xset says', async () => {
        await expect(setScreenPower(false, recorder(true).exec)).rejects.toThrow('unable to open display');
    });
});
