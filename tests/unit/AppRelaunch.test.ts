import {describe, it, expect} from 'vitest';
import {chooseRelaunch, relaunchOptions} from '@/class/AppRelaunch';

const allowed = async () => true;
const refused = async () => false;

describe('chooseRelaunch', () => {
    it('leaves development to `just serve`, which relaunches it when it gave its file', async () => {
        expect(await chooseRelaunch({isPackaged: false, kiosk: false, canRestartKiosk: allowed})).toBe('manual');
        expect(await chooseRelaunch({isPackaged: false, kiosk: true, canRestartKiosk: allowed})).toBe('manual');
        expect(await chooseRelaunch({isPackaged: false, kiosk: false, canRestartKiosk: allowed, devRelaunchFile: '/tmp/x'}))
            .toBe('dev');
        // An installed application never reads it.
        expect(await chooseRelaunch({isPackaged: true, kiosk: false, canRestartKiosk: allowed, devRelaunchFile: '/tmp/x'}))
            .toBe('self');
    });

    it('restarts the kiosk session on a dedicated cabinet, when sudo allows it', async () => {
        expect(await chooseRelaunch({isPackaged: true, kiosk: true, canRestartKiosk: allowed})).toBe('kiosk');
        expect(await chooseRelaunch({isPackaged: true, kiosk: true, canRestartKiosk: refused})).toBe('manual');
    });

    it('relaunches an installed application itself', async () => {
        expect(await chooseRelaunch({isPackaged: true, kiosk: false, canRestartKiosk: refused})).toBe('self');
    });
});

describe('relaunchOptions', () => {
    it('relaunches an AppImage from its file, with the same arguments', () => {
        expect(relaunchOptions('/home/me/maui.AppImage', ['/tmp/.mount_x/maui', '--no-sandbox']))
            .toEqual({execPath: '/home/me/maui.AppImage', args: ['--no-sandbox']});
    });

    it('lets Electron relaunch anything else as it is', () => {
        expect(relaunchOptions(undefined, ['C:\\maui\\maui.exe'])).toEqual({});
    });
});
