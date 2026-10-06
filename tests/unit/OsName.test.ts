import {describe, it, expect, vi} from 'vitest';
import {parseOsRelease, readOsName, type OsNameSources} from '@/class/OsName';

function sources(overrides: Partial<OsNameSources> = {}): OsNameSources {
    return {
        readFile: vi.fn(async () => {
            throw new Error('ENOENT');
        }),
        execFile: vi.fn(async () => {
            throw new Error('unexpected execFile');
        }),
        osRelease: () => '',
        ...overrides,
    };
}

describe('parseOsRelease', () => {
    it('uses PRETTY_NAME', () => {
        expect(parseOsRelease('PRETTY_NAME="Ubuntu 24.04.5 LTS"\nNAME="Ubuntu"\nVERSION_ID="24.04"\n'))
            .toBe('Ubuntu 24.04.5 LTS');
    });

    it('accepts single quotes and no quotes', () => {
        expect(parseOsRelease("PRETTY_NAME='Debian GNU/Linux 13 (trixie)'")).toBe('Debian GNU/Linux 13 (trixie)');
        expect(parseOsRelease('PRETTY_NAME=Alpine')).toBe('Alpine');
    });

    it('falls back to NAME and VERSION_ID', () => {
        expect(parseOsRelease('NAME="Debian GNU/Linux"\nVERSION_ID="13"\n')).toBe('Debian GNU/Linux 13');
        expect(parseOsRelease('NAME=Arch\n')).toBe('Arch');
    });

    it('ignores comments and is empty without any name', () => {
        expect(parseOsRelease('# PRETTY_NAME="Fake"\nID=x\n')).toBe('');
    });
});

describe('readOsName on linux', () => {
    it('reads /etc/os-release', async () => {
        const readFile = vi.fn(async () => 'PRETTY_NAME="Ubuntu 24.04.5 LTS"\n');
        expect(await readOsName('linux', sources({readFile}))).toBe('Ubuntu 24.04.5 LTS');
        expect(readFile).toHaveBeenCalledWith('/etc/os-release');
    });

    it('falls back to /usr/lib/os-release', async () => {
        const readFile = vi.fn(async (path: string) => {
            if (path === '/usr/lib/os-release') {
                return 'PRETTY_NAME="Debian GNU/Linux 13 (trixie)"\n';
            }
            throw new Error('ENOENT');
        });
        expect(await readOsName('linux', sources({readFile}))).toBe('Debian GNU/Linux 13 (trixie)');
    });

    it('is empty when neither file can be read', async () => {
        expect(await readOsName('linux', sources())).toBe('');
    });
});

describe('readOsName on darwin', () => {
    it('names the macOS version from sw_vers', async () => {
        const execFile = vi.fn(async () => '15.1\n');
        expect(await readOsName('darwin', sources({execFile}))).toBe('macOS 15.1');
        expect(execFile).toHaveBeenCalledWith('sw_vers', ['-productVersion']);
    });

    it('is empty when sw_vers fails', async () => {
        expect(await readOsName('darwin', sources())).toBe('');
    });
});

describe('readOsName on win32', () => {
    // The registry ProductName still says "Windows 10" on Windows 11, so the build number decides.
    it('names Windows 11 from build 22000 on', async () => {
        expect(await readOsName('win32', sources({osRelease: () => '10.0.22631'}))).toBe('Windows 11 (build 22631)');
        expect(await readOsName('win32', sources({osRelease: () => '10.0.22000'}))).toBe('Windows 11 (build 22000)');
    });

    it('names Windows 10 below build 22000', async () => {
        expect(await readOsName('win32', sources({osRelease: () => '10.0.19045'}))).toBe('Windows 10 (build 19045)');
    });

    it('is empty for an unexpected release string', async () => {
        expect(await readOsName('win32', sources({osRelease: () => 'weird'}))).toBe('');
    });
});

describe('readOsName elsewhere', () => {
    it('is empty on other platforms', async () => {
        expect(await readOsName('freebsd', sources())).toBe('');
    });

    it('never exceeds 64 characters', async () => {
        const readFile = vi.fn(async () => `PRETTY_NAME="${'x'.repeat(100)}"`);
        expect((await readOsName('linux', sources({readFile}))).length).toBe(64);
    });
});
