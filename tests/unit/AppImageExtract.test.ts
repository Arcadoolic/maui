import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'fs';
import {join} from 'path';
import {tmpdir} from 'os';
import {countEntries, extractAppImage} from '@/class/AppImageExtract';

// A shell script stands in for the AppImage: it prints one line per entry, as --appimage-extract does.
describe.skipIf(process.platform === 'win32')('AppImageExtract', () => {
    let dir: string;

    beforeEach(() => {
        dir = mkdtempSync(join(tmpdir(), 'appimage-extract-'));
    });

    afterEach(() => {
        rmSync(dir, {recursive: true, force: true});
    });

    function fakeAppImage(script: string): string {
        const path = join(dir, 'fake.AppImage');
        writeFileSync(path, `#!/bin/sh\n${script}\n`);
        chmodSync(path, 0o755);
        return path;
    }

    it('reports the entries as they are extracted', async () => {
        const appImage = fakeAppImage('[ "$1" = --appimage-extract ] || exit 9\ni=0\nwhile [ $i -lt 120 ]; do echo "squashfs-root/file$i"; i=$((i+1)); done');
        const reports: number[] = [];

        expect(await extractAppImage(appImage, dir, entries => reports.push(entries))).toBe(120);
        expect(reports.at(-1)).toBe(120);
        expect(reports.length).toBeGreaterThan(1);
    });

    it('fails with the last error line', async () => {
        const appImage = fakeAppImage('echo "squashfs-root/a"\necho "No space left on device" >&2\nexit 1');

        await expect(extractAppImage(appImage, dir, () => undefined))
            .rejects.toThrow('Extraction failed (exit code 1): No space left on device.');
    });

    it('counts the entries of an installed version', async () => {
        mkdirSync(join(dir, 'root', 'usr', 'lib'), {recursive: true});
        writeFileSync(join(dir, 'root', 'AppRun'), '');
        writeFileSync(join(dir, 'root', 'usr', 'lib', 'a.so'), '');

        expect(await countEntries(join(dir, 'root'))).toBe(4);
        expect(await countEntries(join(dir, 'missing'))).toBe(0);
    });
});
