import {execFile} from 'child_process';
import {promisify} from 'util';

// MAME version for the ONLINE startup report. MameService is renderer-only (@electron/remote), so
// the main process asks the binary itself. MAUI-API requires a non-empty value: 'unknown' when the
// binary is missing or says something unexpected.

export const UNKNOWN_MAME_VERSION = 'unknown';
const MAX_LENGTH = 32;
const COMMAND_TIMEOUT_MS = 15_000;

export type ExecFileStdout = (file: string, args: string[]) => Promise<string>;

const execFileAsync = promisify(execFile);

const defaultExecFile: ExecFileStdout = async (file, args) => {
    const {stdout} = await execFileAsync(file, args, {timeout: COMMAND_TIMEOUT_MS, windowsHide: true, encoding: 'utf8'});
    return stdout;
};

// `mame -version` prints e.g. "0.272 (mame0272)".
export function parseMameVersion(output: string): string {
    const version = /^\s*(\d+\.\d+\w*)/.exec(output)?.[1];
    return version ? version.slice(0, MAX_LENGTH) : UNKNOWN_MAME_VERSION;
}

export async function readMameVersion(binaryPath: string, execFileImpl: ExecFileStdout = defaultExecFile): Promise<string> {
    if (binaryPath === '') {
        return UNKNOWN_MAME_VERSION;
    }
    try {
        return parseMameVersion(await execFileImpl(binaryPath, ['-version']));
    } catch {
        return UNKNOWN_MAME_VERSION;
    }
}
