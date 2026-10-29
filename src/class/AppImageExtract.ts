import {spawn} from 'child_process';
import {plainFs} from '@/class/PlainFs';

// Extracting a downloaded AppImage (`--appimage-extract`, SelfUpdate.ts) without blocking the main
// process: thousands of files, a minute or more on a Raspberry Pi, during which neither the BO nor
// the front could show anything. Electron-free, unit-tested.

// How often the extraction reports, at most, in files.
const EXTRACT_REPORT_FILES = 50;

/**
 * The number of entries (files and folders) under `path`: the size of the version installed there,
 * an estimate of the one being extracted. 0 when there is nothing to count.
 */
export async function countEntries(path: string): Promise<number> {
    try {
        // Not Electron's fs: it would count the files packed in app.asar (PlainFs.ts).
        return (await plainFs.promises.readdir(path, {recursive: true})).length;
    } catch {
        return 0;
    }
}

/**
 * Runs `appImagePath --appimage-extract` in `cwd` (it writes squashfs-root/ there), calling
 * `onEntries` with the number of entries extracted so far: the AppImage prints one line per entry.
 * Rejects with the last line of its error output when it fails.
 */
export function extractAppImage(appImagePath: string, cwd: string, onEntries: (entries: number) => void): Promise<number> {
    return new Promise((resolve, reject) => {
        const child = spawn(appImagePath, ['--appimage-extract'], {cwd, stdio: ['ignore', 'pipe', 'pipe']});
        let entries = 0;
        let reported = 0;
        let errorOutput = '';
        child.stdout.on('data', (chunk: Buffer) => {
            for (const byte of chunk) {
                if (byte === 0x0a) {
                    entries++;
                }
            }
            if (entries - reported >= EXTRACT_REPORT_FILES) {
                reported = entries;
                onEntries(entries);
            }
        });
        child.stderr.on('data', (chunk: Buffer) => {
            errorOutput = (errorOutput + chunk.toString()).slice(-2000);
        });
        child.on('error', reject);
        child.on('close', code => {
            if (code === 0) {
                onEntries(entries);
                resolve(entries);
                return;
            }
            const reason = errorOutput.trim().split('\n').pop();
            reject(new Error(`Extraction failed (exit code ${code})${reason ? `: ${reason}` : ''}.`));
        });
    });
}
