import {describe, expect, it} from 'vitest';
import {findWindowsInstaller, isInstalledByInstaller} from '@/class/WindowsUpdate';

describe('findWindowsInstaller', () => {
    const assets = [
        'mame-awesome-ui-2.6.0-linux-x86_64.AppImage',
        'mame-awesome-ui-2.6.0-mac-arm64.zip',
        'mame-awesome-ui-setup-2.6.0-win-x64.exe',
    ];

    it('picks the installer of a release', () => {
        expect(findWindowsInstaller(assets, 'x64')).toBe('mame-awesome-ui-setup-2.6.0-win-x64.exe');
        expect(findWindowsInstaller(['mame-awesome-ui-setup-2.5.0-dev-win-x64.exe'], 'x64')).toBe('mame-awesome-ui-setup-2.5.0-dev-win-x64.exe');
    });

    it('has nothing for a release that only shipped the portable exe, nor for another arch', () => {
        expect(findWindowsInstaller(['mame-awesome-ui-2.5.0-win-x64.exe'], 'x64')).toBeNull();
        expect(findWindowsInstaller(assets, 'arm64')).toBeNull();
        expect(findWindowsInstaller(assets, 'ia32')).toBeNull();
    });
});

describe('isInstalledByInstaller', () => {
    const exe = 'C:\\Users\\me\\AppData\\Local\\Programs\\mame-awesome-ui\\mame-awesome-ui.exe';

    it('recognizes the uninstaller the installer leaves next to the application', () => {
        expect(isInstalledByInstaller(exe, () => ['mame-awesome-ui.exe', 'Uninstall mame-awesome-ui.exe', 'resources'])).toBe(true);
    });

    it('is false for the portable exe and for a folder that cannot be read', () => {
        expect(isInstalledByInstaller(exe, () => ['mame-awesome-ui.exe', 'resources'])).toBe(false);
        expect(isInstalledByInstaller(exe, () => {
            throw new Error('EPERM');
        })).toBe(false);
    });
});
