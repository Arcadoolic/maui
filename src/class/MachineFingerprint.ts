import {execFile} from 'child_process';
import {createHash} from 'crypto';
import {readFile} from 'fs/promises';
import {promisify} from 'util';

// Identifies this cabinet to MAUI-API, which binds the credentials to the first fingerprint it
// sees. Must run in Node (main process or BO server), never in a browser page: the BO is reachable
// from the LAN, and a phone would bind the key to itself. Same OS sources as the node-machine-id
// package. Only the Linux source has been checked on a real machine.

export interface MachineIdSources {
    readFile: (path: string) => Promise<string>;
    // Resolves with stdout.
    execFile: (file: string, args: string[]) => Promise<string>;
}

const COMMAND_TIMEOUT_MS = 5000;
const execFileAsync = promisify(execFile);

const defaultSources: MachineIdSources = {
    readFile: path => readFile(path, 'utf8'),
    execFile: async (file, args) => {
        const {stdout} = await execFileAsync(file, args, {
            timeout: COMMAND_TIMEOUT_MS,
            windowsHide: true,
            encoding: 'utf8',
        });
        return stdout;
    },
};

async function readLinuxMachineId(sources: MachineIdSources): Promise<string> {
    return (await sources.readFile('/etc/machine-id')).trim();
}

async function readDarwinMachineId(sources: MachineIdSources): Promise<string> {
    const output = await sources.execFile('ioreg', ['-rd1', '-c', 'IOPlatformExpertDevice']);
    return /"IOPlatformUUID"\s*=\s*"([^"]+)"/.exec(output)?.[1] ?? '';
}

async function readWindowsMachineId(sources: MachineIdSources): Promise<string> {
    const output = await sources.execFile(
        'reg',
        ['query', 'HKLM\\SOFTWARE\\Microsoft\\Cryptography', '/v', 'MachineGuid'],
    );
    return /MachineGuid\s+REG_SZ\s+(\S+)/.exec(output)?.[1] ?? '';
}

const readers: Partial<Record<NodeJS.Platform, (sources: MachineIdSources) => Promise<string>>> = {
    linux: readLinuxMachineId,
    darwin: readDarwinMachineId,
    win32: readWindowsMachineId,
};

// Empty string when the OS id cannot be read: the fingerprint then rests on localUuid alone.
export async function readOsMachineId(
    platform: NodeJS.Platform = process.platform,
    sources: MachineIdSources = defaultSources,
): Promise<string> {
    const reader = readers[platform];
    if (!reader) {
        return '';
    }
    try {
        return await reader(sources);
    } catch {
        return '';
    }
}

export function computeMachineFingerprint(localUuid: string, osMachineId: string): string {
    if (localUuid === '') {
        throw new Error('localUuid is required to compute the machine fingerprint');
    }
    return createHash('sha256').update(`${localUuid}:${osMachineId}`).digest('hex');
}
