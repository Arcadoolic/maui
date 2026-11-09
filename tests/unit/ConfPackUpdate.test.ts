import {afterEach, beforeEach, describe, expect, it} from 'vitest';
import AdmZip from 'adm-zip';
import {existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'fs';
import {tmpdir} from 'os';
import {join} from 'path';
import type {StartingPackFileEntry} from '@/types/StartingPackManifest';
import {readInstalledConfPackVersion, updateConfPack} from '@/class/ConfPackUpdate';
import type {RepositoryAccess} from '@/class/RepositoryAuth';

/** The configuration pack and the companion the repository writes for it (generate-repo-manifests.py). */
function buildConfPack(hiscoreDat: string, mtime = 1790575353) {
    const zip = new AdmZip();
    zip.addFile('folders/catver.ini', Buffer.from('[Category]\npacman=Maze / Collect\n'));
    zip.addFile('folders/genre.ini', Buffer.from('[Maze]\npacman\n'));
    zip.addFile('folders/Multiplayer.ini', Buffer.from('[2P alt]\npacman\n'));
    zip.addFile('hiscore.dat', Buffer.from(hiscoreDat));
    const file = zip.toBuffer();
    const files: StartingPackFileEntry[] = new AdmZip(file).getEntries().map((entry) => {
        const header = entry.header.offset;
        return {
            name: entry.entryName,
            offset: header + 30 + file.readUInt16LE(header + 26) + file.readUInt16LE(header + 28),
            compressedSize: entry.header.compressedSize,
            size: entry.header.size,
            method: entry.header.method as 0 | 8,
            crc32: entry.header.crc,
        };
    });
    return {file, companion: {formatVersion: null, entries: files.map(f => f.name), zip: {size: file.length, mtime}, files}};
}

/** The repository: the companion as JSON, the ZIP through range requests. Keeps the URLs asked. */
function repositoryServer(pack: {file: Buffer; companion: unknown}, asked: string[]): typeof fetch {
    return (async (url: unknown, init?: RequestInit) => {
        asked.push(String(url));
        if (String(url).endsWith('.manifest.json')) {
            return new Response(JSON.stringify(pack.companion), {status: 200});
        }
        const match = /^bytes=(\d+)-(\d+)$/.exec((init?.headers as Record<string, string>).Range);
        const start = Number(match?.[1]);
        const end = Number(match?.[2]);
        return new Response(new Uint8Array(pack.file.subarray(start, end + 1)), {
            status: 206, headers: {'Content-Range': `bytes ${start}-${end}/${pack.file.length}`},
        });
    }) as unknown as typeof fetch;
}

const repository = async (): Promise<RepositoryAccess> => ({
    ok: true, url: 'https://repo.example', headers: {'X-Maui-Key': 'k', 'Authorization': 'Bearer t', 'X-Maui-Machine': 'm'},
});

describe('updateConfPack', () => {
    let home: string;
    let installedPath: string;
    let lines: string[];

    beforeEach(() => {
        home = mkdtempSync(join(tmpdir(), 'maui-confpack-'));
        writeFileSync(join(home, 'ui.ini'), 'categorypath folders\n');
        installedPath = join(home, 'conf-pack.json');
        lines = [];
    });

    afterEach(() => rmSync(home, {recursive: true, force: true}));

    const run = (pack: {file: Buffer; companion: unknown}, asked: string[] = []) => updateConfPack({
        repository, mameHome: home, installedPath, log: line => lines.push(line), fetchImpl: repositoryServer(pack, asked),
    });

    it('installs the pack when none was installed, and remembers its version', async () => {
        const pack = buildConfPack('kod:\n@:maincpu,program,ff9d94,28,00,04\n');
        const result = await run(pack);
        expect(result).toEqual({kind: 'installed', version: `${pack.file.length}:1790575353`});
        expect(readFileSync(join(home, 'hiscore.dat'), 'utf8')).toContain('ff9d94,28,00,04');
        expect(existsSync(join(home, 'folders', 'genre.ini'))).toBe(true);
        expect(readInstalledConfPackVersion(installedPath)).toBe(`${pack.file.length}:1790575353`);
    });

    it('leaves an up-to-date pack alone, without downloading it', async () => {
        const pack = buildConfPack('kod:\n');
        await run(pack);
        const asked: string[] = [];
        const result = await run(pack, asked);
        expect(result.kind).toBe('up_to_date');
        expect(asked).toEqual(['https://repo.example/mame-conf-pack.manifest.json']);
    });

    it('installs it again when the repository publishes another one', async () => {
        await run(buildConfPack('kod:\n@:maincpu,program,ff9d94,28,01,04\n'));
        const newer = buildConfPack('kod:\n@:maincpu,program,ff9d94,28,00,04\n', 1790600000);
        const result = await run(newer);
        expect(result.kind).toBe('installed');
        expect(readFileSync(join(home, 'hiscore.dat'), 'utf8')).toContain('28,00,04');
    });

    it('installs it again when its files went missing, same version or not', async () => {
        const pack = buildConfPack('kod:\n');
        await run(pack);
        rmSync(join(home, 'folders', 'genre.ini'));
        expect((await run(pack)).kind).toBe('installed');
        expect(existsSync(join(home, 'folders', 'genre.ini'))).toBe(true);
        rmSync(join(home, 'hiscore.dat'));
        expect((await run(pack)).kind).toBe('installed');
        expect(existsSync(join(home, 'hiscore.dat'))).toBe(true);
    });

    it('does nothing before MAME is configured', async () => {
        rmSync(join(home, 'ui.ini'));
        const asked: string[] = [];
        expect(await run(buildConfPack('kod:\n'), asked)).toEqual({kind: 'skipped', reason: 'MAME is not configured yet'});
        expect(asked).toEqual([]);
    });

    it('does nothing without a repository', async () => {
        const result = await updateConfPack({
            repository: async () => ({ok: false, reason: 'online_disabled'}), mameHome: home, installedPath, log: () => undefined,
        });
        expect(result).toEqual({kind: 'skipped', reason: 'no repository (online_disabled)'});
    });

    it('reports a repository that does not answer, without throwing', async () => {
        const failing = (async () => new Response('', {status: 502})) as unknown as typeof fetch;
        const result = await updateConfPack({repository, mameHome: home, installedPath, log: () => undefined, fetchImpl: failing});
        expect(result).toEqual({kind: 'failed', reason: 'HTTP 502'});
    });
});
