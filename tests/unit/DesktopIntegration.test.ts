import {afterEach, beforeEach, describe, expect, it} from 'vitest';
import {existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync} from 'fs';
import {tmpdir} from 'os';
import {join} from 'path';
import {buildDesktopEntry, integrateDesktop, parseDesktopDir, quoteExecArgument} from '@/class/DesktopIntegration';

describe('quoteExecArgument', () => {
    it('quotes a path, spaces included', () => {
        expect(quoteExecArgument('/home/me/My Apps/maui.AppImage')).toBe('"/home/me/My Apps/maui.AppImage"');
    });

    it('escapes the reserved characters and the field codes', () => {
        expect(quoteExecArgument('/a/$b')).toBe('"/a/\\\\$b"');
        expect(quoteExecArgument('/a/b"c')).toBe('"/a/b\\\\"c"');
        expect(quoteExecArgument('/a/b`c')).toBe('"/a/b\\\\`c"');
        expect(quoteExecArgument('/a/b\\c')).toBe('"/a/b\\\\\\\\c"');
        expect(quoteExecArgument('/a/100%')).toBe('"/a/100%%"');
    });
});

describe('buildDesktopEntry', () => {
    it('describes the AppImage', () => {
        const entry = buildDesktopEntry({
            name: 'MAUI',
            comment: 'Awesome Frontend for Mame !',
            exec: '/home/me/Applications/maui.AppImage',
            icon: '/home/me/.local/share/icons/mame-awesome-ui.png',
        });
        expect(entry.split('\n')).toEqual([
            '[Desktop Entry]',
            'Type=Application',
            'Name=MAUI',
            'Comment=Awesome Frontend for Mame !',
            'Exec="/home/me/Applications/maui.AppImage"',
            'TryExec=/home/me/Applications/maui.AppImage',
            'Icon=/home/me/.local/share/icons/mame-awesome-ui.png',
            'Terminal=false',
            'Categories=Game;Emulator;',
            'Keywords=mame;arcade;',
            'StartupWMClass=mame-awesome-ui',
            '',
        ]);
    });
});

describe('parseDesktopDir', () => {
    it('reads the desktop directory, whatever its name', () => {
        expect(parseDesktopDir('XDG_DESKTOP_DIR="$HOME/Bureau"\nXDG_DOWNLOAD_DIR="$HOME/Téléchargements"\n', '/home/me')).toBe('/home/me/Bureau');
        expect(parseDesktopDir('# comment\nXDG_DESKTOP_DIR="/mnt/data/Desktop/"\n', '/home/me')).toBe('/mnt/data/Desktop');
    });

    it('has none when it is not declared, is the home directory or is not absolute', () => {
        expect(parseDesktopDir('XDG_DOWNLOAD_DIR="$HOME/Downloads"\n', '/home/me')).toBeNull();
        expect(parseDesktopDir('XDG_DESKTOP_DIR="$HOME/"\n', '/home/me')).toBeNull();
        expect(parseDesktopDir('XDG_DESKTOP_DIR="Desktop"\n', '/home/me')).toBeNull();
    });
});

describe('integrateDesktop', () => {
    let home: string;
    let iconSourcePath: string;

    const entryPath = () => join(home, '.local', 'share', 'applications', 'mame-awesome-ui.desktop');
    const iconPath = () => join(home, '.local', 'share', 'icons', 'mame-awesome-ui.png');
    const shortcutPath = () => join(home, 'Bureau', 'mame-awesome-ui.desktop');
    const integrate = (appImagePath: string, env: Record<string, string | undefined> = {}) => integrateDesktop({
        appImagePath,
        iconSourcePath,
        name: 'MAUI',
        comment: 'Awesome Frontend for Mame !',
        homeDir: home,
        env,
    });

    beforeEach(() => {
        home = mkdtempSync(join(tmpdir(), 'maui-desktop-'));
        iconSourcePath = join(home, 'source-icon.png');
        writeFileSync(iconSourcePath, 'icon');
        mkdirSync(join(home, '.config'));
        writeFileSync(join(home, '.config', 'user-dirs.dirs'), 'XDG_DESKTOP_DIR="$HOME/Bureau"\n');
        mkdirSync(join(home, 'Bureau'));
    });

    afterEach(() => {
        rmSync(home, {recursive: true, force: true});
    });

    it('adds the menu entry, the icon and an executable shortcut on the desktop', () => {
        integrate('/apps/maui-1.AppImage');

        expect(readFileSync(iconPath(), 'utf8')).toBe('icon');
        const entry = readFileSync(entryPath(), 'utf8');
        expect(entry).toContain('Exec="/apps/maui-1.AppImage"');
        expect(entry).toContain(`Icon=${iconPath()}`);
        expect(readFileSync(shortcutPath(), 'utf8')).toBe(entry);
        expect(statSync(shortcutPath()).mode & 0o111).toBe(0o111);
    });

    it('follows an AppImage that was moved or replaced', () => {
        integrate('/apps/maui-1.AppImage');
        integrate('/apps/maui-2.AppImage');

        expect(readFileSync(entryPath(), 'utf8')).toContain('Exec="/apps/maui-2.AppImage"');
        expect(readFileSync(shortcutPath(), 'utf8')).toContain('Exec="/apps/maui-2.AppImage"');
    });

    it('does not bring back a shortcut the user removed', () => {
        integrate('/apps/maui-1.AppImage');
        rmSync(shortcutPath());
        integrate('/apps/maui-2.AppImage');

        expect(existsSync(shortcutPath())).toBe(false);
        expect(readFileSync(entryPath(), 'utf8')).toContain('Exec="/apps/maui-2.AppImage"');
    });

    it('leaves files that are already right untouched', () => {
        integrate('/apps/maui-1.AppImage');
        const before = statSync(entryPath()).mtimeMs;
        integrate('/apps/maui-1.AppImage');

        expect(statSync(entryPath()).mtimeMs).toBe(before);
    });

    it('only adds the menu entry when there is no desktop directory', () => {
        rmSync(join(home, 'Bureau'), {recursive: true});
        integrate('/apps/maui-1.AppImage');

        expect(existsSync(entryPath())).toBe(true);
        expect(existsSync(join(home, 'Bureau'))).toBe(false);
    });

    it('honours XDG_DATA_HOME', () => {
        const dataHome = join(home, 'data');
        integrate('/apps/maui-1.AppImage', {XDG_DATA_HOME: dataHome});

        expect(existsSync(join(dataHome, 'applications', 'mame-awesome-ui.desktop'))).toBe(true);
        expect(existsSync(entryPath())).toBe(false);
    });

    it('does nothing for a path a desktop entry cannot hold', () => {
        integrate('relative/maui.AppImage');
        integrate('/apps/ma\nui.AppImage');

        expect(existsSync(entryPath())).toBe(false);
    });
});
