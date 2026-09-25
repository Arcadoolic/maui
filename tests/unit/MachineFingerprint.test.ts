import {describe, it, expect, vi} from 'vitest';
import {
    computeMachineFingerprint,
    readOsMachineId,
    type MachineIdSources,
} from '@/class/MachineFingerprint';

const LOCAL_UUID = '0b7c2f1e-5a3d-4c8e-9f10-2a3b4c5d6e7f';

function sources(overrides: Partial<MachineIdSources> = {}): MachineIdSources {
    return {
        readFile: vi.fn(async () => {
            throw new Error('unexpected readFile');
        }),
        execFile: vi.fn(async () => {
            throw new Error('unexpected execFile');
        }),
        ...overrides,
    };
}

describe('computeMachineFingerprint', () => {
    it('is the lowercase hex SHA-256 of localUuid:osMachineId', () => {
        expect(computeMachineFingerprint(LOCAL_UUID, '4c4c4544004e3510804bb4c04f4a3232'))
            .toBe('6d0a6f343b48b9bf7dd9574cec1c852e244515bd7c90cb76d007a9c06d125db7');
    });

    it('still hashes with an empty OS machine id', () => {
        expect(computeMachineFingerprint(LOCAL_UUID, ''))
            .toBe('97b0726e4dba3add7c51516e7af20230e6ec2b09a1fe0a101fa9c8c0a82c9550');
    });

    it('always matches the format the API requires', () => {
        expect(computeMachineFingerprint(LOCAL_UUID, 'x')).toMatch(/^[0-9a-f]{64}$/);
    });

    it('refuses an empty localUuid, which would collide across machines without an OS id', () => {
        expect(() => computeMachineFingerprint('', 'abc')).toThrow(/localUuid/);
    });
});

describe('readOsMachineId on linux', () => {
    it('reads /etc/machine-id, trimmed', async () => {
        const readFile = vi.fn(async () => '4c4c4544004e3510804bb4c04f4a3232\n');
        expect(await readOsMachineId('linux', sources({readFile}))).toBe('4c4c4544004e3510804bb4c04f4a3232');
        expect(readFile).toHaveBeenCalledWith('/etc/machine-id');
    });

    it('is empty when the file cannot be read', async () => {
        expect(await readOsMachineId('linux', sources())).toBe('');
    });
});

describe('readOsMachineId on darwin', () => {
    const ioregOutput = [
        '+-o J316sAP  <class IOPlatformExpertDevice, id 0x100000223, registered, matched, active>',
        '    {',
        '      "IOPlatformSerialNumber" = "C02XXXXXXXXX"',
        '      "IOPlatformUUID" = "5A0A2B84-1C3F-5D2E-9A6B-1234567890AB"',
        '      "IOPolledInterface" = "AppleARMWatchdogTimerHibernateHandler is not serializable"',
        '    }',
        '',
    ].join('\n');

    it('extracts IOPlatformUUID from ioreg', async () => {
        const execFile = vi.fn(async () => ioregOutput);
        expect(await readOsMachineId('darwin', sources({execFile}))).toBe('5A0A2B84-1C3F-5D2E-9A6B-1234567890AB');
        expect(execFile).toHaveBeenCalledWith('ioreg', ['-rd1', '-c', 'IOPlatformExpertDevice']);
    });

    it('is empty when ioreg has no IOPlatformUUID', async () => {
        const execFile = vi.fn(async () => '    {\n    }\n');
        expect(await readOsMachineId('darwin', sources({execFile}))).toBe('');
    });

    it('is empty when ioreg fails', async () => {
        expect(await readOsMachineId('darwin', sources())).toBe('');
    });
});

describe('readOsMachineId on win32', () => {
    const regOutput = [
        '',
        'HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Cryptography',
        '    MachineGuid    REG_SZ    3f2504e0-4f89-11d3-9a0c-0305e82c3301',
        '',
        '',
    ].join('\r\n');

    it('extracts MachineGuid from reg query', async () => {
        const execFile = vi.fn(async () => regOutput);
        expect(await readOsMachineId('win32', sources({execFile}))).toBe('3f2504e0-4f89-11d3-9a0c-0305e82c3301');
        expect(execFile).toHaveBeenCalledWith(
            'reg',
            ['query', 'HKLM\\SOFTWARE\\Microsoft\\Cryptography', '/v', 'MachineGuid'],
        );
    });

    it('is empty when the value is missing', async () => {
        const execFile = vi.fn(async () => 'ERROR: The system was unable to find the specified registry key or value.\r\n');
        expect(await readOsMachineId('win32', sources({execFile}))).toBe('');
    });

    it('is empty when reg fails', async () => {
        expect(await readOsMachineId('win32', sources())).toBe('');
    });
});

describe('readOsMachineId on other platforms', () => {
    it('is empty without touching the system', async () => {
        const deps = sources();
        expect(await readOsMachineId('freebsd', deps)).toBe('');
        expect(deps.readFile).not.toHaveBeenCalled();
        expect(deps.execFile).not.toHaveBeenCalled();
    });
});
