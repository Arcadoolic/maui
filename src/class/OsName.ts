import {execFile} from 'child_process';
import {readFile} from 'fs/promises';
import {release} from 'os';
import {promisify} from 'util';

// Human-readable OS name for the ONLINE startup report ("Ubuntu 24.04.5 LTS", "macOS 15.1",
// "Windows 11 (build 22631)"), next to os_version, which is only the kernel (os.release()).
// Empty when unknown. Only the Linux source has been checked on a real machine.

export interface OsNameSources {
    readFile: (path: string) => Promise<string>;
    // Resolves with stdout.
    execFile: (file: string, args: string[]) => Promise<string>;
    osRelease: () => string;
}

const MAX_LENGTH = 64;
const COMMAND_TIMEOUT_MS = 5000;
const WINDOWS_11_FIRST_BUILD = 22000;
const execFileAsync = promisify(execFile);

const defaultSources: OsNameSources = {
    readFile: path => readFile(path, 'utf8'),
    execFile: async (file, args) => {
        const {stdout} = await execFileAsync(file, args, {timeout: COMMAND_TIMEOUT_MS, windowsHide: true, encoding: 'utf8'});
        return stdout;
    },
    osRelease: release,
};

function unquote(value: string): string {
    return value.trim().replace(/^(["'])(.*)\1$/, '$2');
}

// os-release format (freedesktop.org): KEY=value lines, value optionally quoted.
export function parseOsRelease(content: string): string {
    const fields = new Map<string, string>();
    for (const line of content.split('\n')) {
        const match = /^\s*([A-Z_]+)=(.*)$/.exec(line);
        if (match) {
            fields.set(match[1], unquote(match[2]));
        }
    }
    const pretty = fields.get('PRETTY_NAME');
    if (pretty) {
        return pretty;
    }
    const name = fields.get('NAME');
    if (!name) {
        return '';
    }
    const version = fields.get('VERSION_ID');
    return version ? `${name} ${version}` : name;
}

async function readLinuxName(sources: OsNameSources): Promise<string> {
    for (const path of ['/etc/os-release', '/usr/lib/os-release']) {
        try {
            return parseOsRelease(await sources.readFile(path));
        } catch {
            // Try the next location.
        }
    }
    return '';
}

async function readDarwinName(sources: OsNameSources): Promise<string> {
    const version = (await sources.execFile('sw_vers', ['-productVersion'])).trim();
    return version ? `macOS ${version}` : '';
}

// The registry ProductName (what os.version() reads) still says "Windows 10" on Windows 11, so
// the build number from os.release() ("10.0.22631") decides.
async function readWindowsName(sources: OsNameSources): Promise<string> {
    const build = Number(/^10\.0\.(\d+)/.exec(sources.osRelease())?.[1]);
    if (!Number.isInteger(build)) {
        return '';
    }
    return `Windows ${build >= WINDOWS_11_FIRST_BUILD ? 11 : 10} (build ${build})`;
}

const readers: Partial<Record<NodeJS.Platform, (sources: OsNameSources) => Promise<string>>> = {
    linux: readLinuxName,
    darwin: readDarwinName,
    win32: readWindowsName,
};

export async function readOsName(
    platform: NodeJS.Platform = process.platform,
    sources: OsNameSources = defaultSources,
): Promise<string> {
    const reader = readers[platform];
    if (!reader) {
        return '';
    }
    try {
        return (await reader(sources)).slice(0, MAX_LENGTH);
    } catch {
        return '';
    }
}
