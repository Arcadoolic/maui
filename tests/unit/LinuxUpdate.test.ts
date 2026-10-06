import {describe, expect, it} from 'vitest';
import {findLinuxAppImage} from '@/class/LinuxUpdate';

describe('findLinuxAppImage', () => {
    const assets = [
        'mame-awesome-ui-2.6.0-linux-arm64.AppImage',
        'mame-awesome-ui-2.6.0-linux-x86_64.AppImage',
        'mame-awesome-ui-2.6.0-mac-arm64.zip',
        'mame-awesome-ui-setup-2.6.0-win-x64.exe',
    ];

    it('picks the AppImage of the arch, named x86_64 for x64', () => {
        expect(findLinuxAppImage(assets, 'x64')).toBe('mame-awesome-ui-2.6.0-linux-x86_64.AppImage');
        expect(findLinuxAppImage(assets, 'arm64')).toBe('mame-awesome-ui-2.6.0-linux-arm64.AppImage');
        expect(findLinuxAppImage(['mame-awesome-ui-2.6.0-dev-linux-x86_64.AppImage'], 'x64')).toBe('mame-awesome-ui-2.6.0-dev-linux-x86_64.AppImage');
    });

    it('has nothing for an arch that is not built, nor for a release without an AppImage', () => {
        expect(findLinuxAppImage(assets, 'arm')).toBeNull();
        expect(findLinuxAppImage(['mame-awesome-ui-2.6.0-mac-arm64.zip'], 'arm64')).toBeNull();
    });
});
