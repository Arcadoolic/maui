import {chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync} from 'fs';
import {dirname, isAbsolute, join} from 'path';

/**
 * Desktop integration of the Linux AppImage: an AppImage is run without being installed, so
 * nothing puts it in the applications menu. At each start the application writes its own desktop
 * entry (freedesktop.org's Desktop Entry Specification) and a copy of its icon in the user's data
 * directory - what the installer does on Windows (electron-builder.yml's nsis). Written again
 * whenever it differs, so an AppImage that was moved, renamed or replaced by another version
 * repairs its entry the next time it is started.
 *
 * Electron-free (see background.ts for the caller): only runs for a real AppImage, not for the
 * cabinet's extracted ~/squashfs-root (docs/RASPBERRY-PI-DEPLOY.md), which has no menu to be in.
 */

/**
 * Name of the desktop entry, without its extension. Must stay the application's name
 * (package.json): Electron gives it to its windows as class (X11) and app_id (Wayland), which is
 * how the desktop finds the entry, and so the icon, of a running window.
 */
export const DESKTOP_ENTRY_ID = 'mame-awesome-ui';

export interface DesktopEntry {
    name: string;
    comment: string;
    // Absolute path of the AppImage.
    exec: string;
    // Absolute path of the icon.
    icon: string;
}

export interface DesktopIntegrationOptions {
    // The AppImage's own path: the APPIMAGE variable its runtime sets.
    appImagePath: string;
    // The icon shipped with the application (staticPath.ts's getAppIconPath()).
    iconSourcePath: string;
    name: string;
    comment: string;
    homeDir: string;
    env: Record<string, string | undefined>;
}

// Values of type string: a backslash is written twice.
function escapeString(value: string): string {
    return value.replace(/\\/g, '\\\\');
}

/**
 * A path as an argument of the Exec key: between double quotes, with the characters the
 * specification reserves escaped, then the escaping of string values on top of it (hence two
 * backslashes in front of a dollar sign, four for a backslash). A percent sign is a field code.
 */
export function quoteExecArgument(argument: string): string {
    const quoted = `"${argument.replace(/(["`$\\])/g, '\\$1')}"`;
    return escapeString(quoted).replace(/%/g, '%%');
}

export function buildDesktopEntry(entry: DesktopEntry): string {
    return [
        '[Desktop Entry]',
        'Type=Application',
        `Name=${escapeString(entry.name)}`,
        `Comment=${escapeString(entry.comment)}`,
        `Exec=${quoteExecArgument(entry.exec)}`,
        // The menu leaves out an entry whose AppImage is gone (deleted, or replaced by a version
        // named otherwise that was not started yet).
        `TryExec=${escapeString(entry.exec)}`,
        `Icon=${escapeString(entry.icon)}`,
        'Terminal=false',
        'Categories=Game;Emulator;',
        'Keywords=mame;arcade;',
        `StartupWMClass=${DESKTOP_ENTRY_ID}`,
        '',
    ].join('\n');
}

/**
 * The user's desktop directory, from xdg-user-dirs' user-dirs.dirs (it is "Bureau" on a French
 * system). Null when it is not declared, or declared as the home directory itself, which is how
 * xdg-user-dirs says there is none.
 */
export function parseDesktopDir(userDirs: string, homeDir: string): string | null {
    const match = /^\s*XDG_DESKTOP_DIR="(.*)"\s*$/m.exec(userDirs);
    if (!match) {
        return null;
    }
    const path = match[1].replace(/^\$HOME(?=\/|$)/, homeDir).replace(/\/+$/, '');
    if (!isAbsolute(path) || path === homeDir.replace(/\/+$/, '')) {
        return null;
    }
    return path;
}

function readOrNull(path: string): Buffer | null {
    try {
        return readFileSync(path);
    } catch {
        return null;
    }
}

function writeIfChanged(path: string, content: Buffer): void {
    if (readOrNull(path)?.equals(content)) {
        return;
    }
    mkdirSync(dirname(path), {recursive: true});
    writeFileSync(path, content);
}

function findDesktopDir(options: DesktopIntegrationOptions): string | null {
    const configHome = options.env.XDG_CONFIG_HOME || join(options.homeDir, '.config');
    const userDirs = readOrNull(join(configHome, 'user-dirs.dirs'));
    const desktopDir = userDirs ? parseDesktopDir(userDirs.toString('utf8'), options.homeDir) : null;
    return desktopDir && existsSync(desktopDir) ? desktopDir : null;
}

/**
 * Puts the application in the menu, and its shortcut on the desktop. The shortcut is only created
 * together with the menu entry, the first time: one the user removed never comes back, one still
 * there follows the AppImage like the menu entry does.
 */
export function integrateDesktop(options: DesktopIntegrationOptions): void {
    // A path a desktop entry cannot hold.
    if (!isAbsolute(options.appImagePath) || /[\n\r]/.test(options.appImagePath)) {
        return;
    }
    const dataHome = options.env.XDG_DATA_HOME || join(options.homeDir, '.local', 'share');
    // Outside the AppImage: its own files are only there while it runs, mounted under a path that
    // changes at each start.
    const iconPath = join(dataHome, 'icons', `${DESKTOP_ENTRY_ID}.png`);
    const entryPath = join(dataHome, 'applications', `${DESKTOP_ENTRY_ID}.desktop`);
    const firstTime = !existsSync(entryPath);

    writeIfChanged(iconPath, readFileSync(options.iconSourcePath));
    const entry = Buffer.from(buildDesktopEntry({
        name: options.name,
        comment: options.comment,
        exec: options.appImagePath,
        icon: iconPath,
    }), 'utf8');
    writeIfChanged(entryPath, entry);

    const desktopDir = findDesktopDir(options);
    if (!desktopDir) {
        return;
    }
    const shortcutPath = join(desktopDir, `${DESKTOP_ENTRY_ID}.desktop`);
    if (firstTime || existsSync(shortcutPath)) {
        writeIfChanged(shortcutPath, entry);
        // Desktops only start a shortcut that is executable.
        chmodSync(shortcutPath, 0o755);
    }
}
