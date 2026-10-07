import {afterEach, beforeEach, describe, expect, it} from 'vitest';
import AdmZip from 'adm-zip';
import {randomBytes} from 'crypto';
import {existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync} from 'fs';
import {tmpdir} from 'os';
import {join} from 'path';
import type {StartingPackFileEntry, StartingPackGameEntry} from '@/types/StartingPackManifest';
import type {RomVerdict} from '@/class/MameVerifyRoms';
import {
    describePack, importRepositoryPack, PackGameFields, PackGameStore, PackImportOptions, PackImportTargets,
} from '@/class/PackImport';

const game = (romName: string, extra: Partial<StartingPackGameEntry> = {}): StartingPackGameEntry => ({
    romName, fullname: romName.toUpperCase(), shortname: romName, subname: '', manufacturer: 'Acme', year: '1984',
    categoryName: 'Shooter', player_alt: 2, player_sim: 0, biosName: null, hasRomFile: true, hasMarquee: true,
    hasFlyer: false, hasLogo: false, ...extra,
});

/** A ZIP and the companion manifest the repository would write for it (generate-repo-manifests.py). */
function buildPack(entries: {[name: string]: Buffer}, manifest: object | null) {
    const zip = new AdmZip();
    for (const [name, data] of Object.entries(entries)) {
        zip.addFile(name, data);
    }
    if (manifest) {
        zip.addFile('manifest.json', Buffer.from(JSON.stringify(manifest)));
    }
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
    const companion = {
        ...(manifest ?? {formatVersion: null, note: 'no internal manifest.json found', entries: files.map(entry => entry.name)}),
        zip: {size: file.length, mtime: 1790440985},
        files,
    };
    return {file, companion};
}

/** The repository: answers range requests on `file`, keeping what was asked. */
function rangeServer(file: Buffer, log: string[] = []): typeof fetch {
    return (async (_url: unknown, init?: RequestInit) => {
        const range = (init?.headers as Record<string, string>).Range;
        log.push(range);
        const match = /^bytes=(\d+)-(\d+)$/.exec(range);
        const start = Number(match?.[1]);
        const end = Number(match?.[2]);
        return new Response(new Uint8Array(file.subarray(start, end + 1)), {
            status: 206, headers: {'Content-Range': `bytes ${start}-${end}/${file.length}`},
        });
    }) as unknown as typeof fetch;
}

describe('importRepositoryPack', () => {
    let home: string;
    let targets: PackImportTargets;
    let lines: string[];
    let progress: string[];
    let games: Map<string, PackGameFields>;
    let store: PackGameStore;

    const run = (pack: {file: Buffer; companion: unknown}, extra: Partial<PackImportOptions> = {}) => importRepositoryPack({
        url: 'http://repo/some-pack.zip',
        headers: {'X-Maui-Key': 'mk_test'},
        companion: pack.companion,
        targets,
        store,
        reporter: {line: text => lines.push(text), progress: (phase, done, total) => progress.push(`${phase} ${done}/${total}`)},
        fetchImpl: rangeServer(pack.file),
        ...extra,
    });

    beforeEach(() => {
        home = mkdtempSync(join(tmpdir(), 'maui-pack-import-'));
        const directory = (name: string): string => {
            mkdirSync(join(home, name), {recursive: true});
            return join(home, name);
        };
        const iniKeys: Record<string, string> = {categorypath: 'folders', samplepath: 'samples', cfg_directory: 'cfg'};
        targets = {
            iniPath: home,
            romPath: directory('roms'),
            marqueePath: directory('marquees'),
            flyerPath: directory('flyers'),
            logoPath: directory('logos'),
            categoryDir: directory('folders'),
            romsInfosCachePath: join(home, 'roms-infos-cache.json'),
            directoryFor: iniKey => (iniKeys[iniKey] ? directory(iniKeys[iniKey]) : null),
            favoritesPath: () => join(directory('ui'), 'favorites.ini'),
        };
        lines = [];
        progress = [];
        games = new Map();
        const categories: string[] = [];
        store = {
            findOrCreateCategory: async (name) => {
                const created = !categories.includes(name);
                if (created) {
                    categories.push(name);
                }
                return {id: categories.indexOf(name) + 1, created};
            },
            upsertGame: async (romName, fields) => {
                games.set(romName, fields);
            },
        };
    });

    afterEach(() => {
        rmSync(home, {recursive: true, force: true});
    });

    const rom = (name: string): Buffer => Buffer.from(`rom of ${name} `.repeat(200));
    const starterPack = () => buildPack({
        'roms/alpha.zip': rom('alpha'),
        'roms/beta.zip': rom('beta'),
        'roms/neogeo.zip': rom('neogeo'),
        'marquees/alpha.png': Buffer.from('alpha marquee'),
        'marquees/beta.png': Buffer.from('beta marquee'),
        'samples/knock.zip': Buffer.from('knock'),
        'cfg/alpha.cfg': Buffer.from('<mameconfig/>'),
    }, {
        formatVersion: 1,
        generatedAt: '2026-09-20T11:55:30.726Z',
        games: [
            game('alpha', {biosName: 'neogeo', sampleSet: 'knock', publisher: 'Acme', developer: 'Acme Labs'}),
            game('beta', {year: '198?', categoryName: 'Maze'}),
        ],
        biosRoms: ['neogeo'],
        sampleSets: ['knock'],
    });

    it('installs a whole pack: files, games, favorites and publishers', async () => {
        const pack = starterPack();
        const log: string[] = [];

        const ok = await run(pack, {fetchImpl: rangeServer(pack.file, log)});

        expect(lines.filter(line => line.includes('ERROR'))).toEqual([]);
        expect(ok).toBe(true);
        expect(readFileSync(join(home, 'roms', 'alpha.zip'))).toEqual(rom('alpha'));
        expect(readFileSync(join(home, 'roms', 'neogeo.zip'))).toEqual(rom('neogeo'));
        expect(readFileSync(join(home, 'marquees', 'beta.png'), 'utf8')).toBe('beta marquee');
        expect(readFileSync(join(home, 'samples', 'knock.zip'), 'utf8')).toBe('knock');
        expect(readFileSync(join(home, 'cfg', 'alpha.cfg'), 'utf8')).toBe('<mameconfig/>');
        expect(readdirSync(join(home, 'roms')).some(name => name.endsWith('.part'))).toBe(false);

        expect(games.get('alpha')).toMatchObject({id_category: 1, fullname: 'ALPHA', year: 1984, hi: false, player_alt: 2});
        expect(games.get('beta')).toMatchObject({id_category: 2, year: 198});

        const favorites = readFileSync(join(home, 'ui', 'favorites.ini'), 'utf8');
        expect(favorites.startsWith('﻿[ROOT_FOLDER]\n[Favorite]\n\n')).toBe(true);
        expect(favorites).toContain('alpha\nALPHA\n\n\n\n0\n\nalpha\n\n\n\n1\n\n\n\n1\n');
        expect(JSON.parse(readFileSync(join(home, 'roms-infos-cache.json'), 'utf8')).entries).toEqual({
            alpha: {publisher: 'Acme', publisherId: null, developer: 'Acme Labs', developerId: null, fetchedAt: '2026-09-20T11:55:30.726Z'},
        });

        // Neighbours in the ZIP come together: far fewer requests than files, never the whole ZIP.
        expect(log.length).toBeLessThan(3);
        expect(lines.at(-3)).toContain('2 game(s) imported — 2 rom(s) written — 1 bios written — 2 marquee(s)');
        expect(progress.at(-1)).toBe('import 2/2');
    });

    it('leaves out the game the installed MAME cannot run: no rom, no row, no favorite', async () => {
        const pack = starterPack();
        const asked: string[][] = [];

        const ok = await run(pack, {
            verifyRoms: async (romNames) => {
                asked.push(romNames);
                // The sets are in the rompath by the time MAME is asked.
                expect(existsSync(join(home, 'roms', 'beta.zip'))).toBe(true);
                return new Map<string, RomVerdict>([
                    ['alpha', {status: 'good'}],
                    ['beta', {status: 'bad', problems: ['a.bin (256 bytes) - NOT FOUND', 'b', 'c', 'd']}],
                ]);
            },
        });

        expect(ok).toBe(true);
        expect(asked).toEqual([['alpha', 'beta']]);
        expect([...games.keys()]).toEqual(['alpha']);
        expect(readdirSync(join(home, 'roms')).sort()).toEqual(['alpha.zip', 'neogeo.zip']);
        const favorites = readFileSync(join(home, 'ui', 'favorites.ini'), 'utf8');
        expect(favorites).toContain('alpha\nALPHA');
        expect(favorites).not.toContain('beta');
        expect(lines).toContain('  beta: not imported, the installed MAME cannot run it '
            + '(a.bin (256 bytes) - NOT FOUND; b; c; and 1 more).');
        expect(lines.some(line => line.includes('1 game(s) imported') && line.endsWith('1 game(s) not compatible with the installed MAME'))).toBe(true);
        expect(progress.at(-1)).toBe('import 2/2');
    });

    it('does not fetch the game the manifest already tells the installed MAME cannot run', async () => {
        const pack = starterPack();
        const log: string[] = [];
        const verified: string[][] = [];

        const ok = await run(pack, {
            fetchImpl: rangeServer(pack.file, log),
            precheckGames: async () => new Map([['alpha', 'the pack lacks alpha/a.bin']]),
            verifyRoms: async (romNames) => {
                verified.push(romNames);
                return new Map();
            },
        });

        expect(ok).toBe(true);
        expect(lines).toContain('  alpha: not fetched, the installed MAME cannot run it (the pack lacks alpha/a.bin).');
        // Neither its files nor the BIOS and samples only it needed.
        expect(readdirSync(join(home, 'roms'))).toEqual(['beta.zip']);
        expect(readdirSync(join(home, 'marquees'))).toEqual(['beta.png']);
        expect(readdirSync(join(home, 'samples'))).toEqual([]);
        expect([...games.keys()]).toEqual(['beta']);
        expect(readFileSync(join(home, 'ui', 'favorites.ini'), 'utf8')).not.toContain('alpha');
        expect(verified).toEqual([['beta']]);
        expect(lines.some(line => line.endsWith('1 game(s) not compatible with the installed MAME'))).toBe(true);
    });

    it('never brings back a game removed from the favorites, even ticked on its own', async () => {
        const pack = starterPack();
        const removedGames = () => new Set(['alpha']);

        expect(await run(pack, {removedGames})).toBe(true);

        expect(lines).toContain('  alpha: not fetched, it was removed from the favorites (restore it from the Removed tab).');
        expect(readdirSync(join(home, 'roms'))).toEqual(['beta.zip']);
        expect(readdirSync(join(home, 'marquees'))).toEqual(['beta.png']);
        expect([...games.keys()]).toEqual(['beta']);
        expect(readFileSync(join(home, 'ui', 'favorites.ini'), 'utf8')).not.toContain('alpha');
        expect(lines.some(line => line.includes('1 game(s) imported') && line.endsWith('1 game(s) skipped, removed from the favorites'))).toBe(true);

        expect(await run(pack, {removedGames, only: ['alpha']})).toBe(true);
        expect([...games.keys()]).toEqual(['beta']);
        expect(existsSync(join(home, 'roms', 'alpha.zip'))).toBe(false);
    });

    it('imports every game when the manifest cannot tell', async () => {
        expect(await run(starterPack(), {precheckGames: async () => null})).toBe(true);

        expect([...games.keys()]).toEqual(['alpha', 'beta']);
    });

    it('leaves out a game the installed MAME does not know', async () => {
        const ok = await run(starterPack(), {verifyRoms: async () => new Map<string, RomVerdict>([['alpha', {status: 'unknown'}]])});

        expect(ok).toBe(true);
        expect([...games.keys()]).toEqual(['beta']);
        expect(lines).toContain('  alpha: not imported, the installed MAME cannot run it (it does not know this game).');
    });

    it('imports every game when MAME cannot be asked, and says so', async () => {
        expect(await run(starterPack(), {verifyRoms: async () => null})).toBe(true);

        expect([...games.keys()]).toEqual(['alpha', 'beta']);
        expect(lines).toContain('[import] WARNING: The installed MAME could not check the roms: games imported unchecked.');
    });

    it('installs only the games picked, with the sets they need', async () => {
        const pack = starterPack();

        expect(await run(pack, {only: ['beta', 'ghost']})).toBe(true);

        expect(readdirSync(join(home, 'roms'))).toEqual(['beta.zip']);
        expect(readdirSync(join(home, 'marquees'))).toEqual(['beta.png']);
        expect(readdirSync(join(home, 'samples'))).toEqual([]);
        expect([...games.keys()]).toEqual(['beta']);
        expect(lines).toContain('[import] WARNING: ghost: not in this pack, skipped.');
    });

    it('keeps the favorites already there and adds a game once', async () => {
        const pack = starterPack();
        mkdirSync(join(home, 'ui'));
        writeFileSync(join(home, 'ui', 'favorites.ini'), '[ROOT_FOLDER]\r\n[Favorite]\r\n\r\nalpha\r\nMine\r\n');

        await run(pack);

        const favorites = readFileSync(join(home, 'ui', 'favorites.ini'), 'utf8');
        expect(favorites.match(/^alpha\r$/gm)?.length).toBe(1);
        expect(favorites).toContain('beta\r\nBETA\r\n');
    });

    it('installs a pack without games: its mame folders and root files', async () => {
        const pack = buildPack({
            'folders/genre.ini': Buffer.from('[Shooter]\nalpha\n'),
            'folders/sub/extra.ini': Buffer.from('x'),
            'hiscore.dat': Buffer.from('alpha:\n'),
        }, null);

        expect(await run(pack)).toBe(true);

        expect(readFileSync(join(home, 'folders', 'genre.ini'), 'utf8')).toBe('[Shooter]\nalpha\n');
        expect(existsSync(join(home, 'folders', 'sub', 'extra.ini'))).toBe(true);
        expect(readFileSync(join(home, 'hiscore.dat'), 'utf8')).toBe('alpha:\n');
        expect(games.size).toBe(0);
        expect(lines).toContain('[import] Folder(s) imported: folders (2), hiscore.dat (1)');
    });

    it('never writes outside the destination of a folder', async () => {
        const pack = buildPack({'folders/genre.ini': Buffer.from('ok'), 'folders/evil.ini': Buffer.from('evil')}, null);
        const companion = pack.companion as {files: StartingPackFileEntry[]};
        companion.files.filter(file => file.name === 'folders/evil.ini').forEach((file) => {
            file.name = 'folders/../../evil.ini';
        });

        await run(pack);

        expect(existsSync(join(home, 'folders', 'genre.ini'))).toBe(true);
        expect(existsSync(join(home, '..', 'evil.ini'))).toBe(false);
        expect(existsSync(join(home, 'evil.ini'))).toBe(false);
    });

    it('refuses a pack re-published since its manifest was written', async () => {
        const pack = starterPack();
        (pack.companion as {zip: {size: number}}).zip.size += 1;

        expect(await run(pack)).toBe(false);

        expect(readdirSync(join(home, 'roms'))).toEqual([]);
        expect(games.size).toBe(0);
        expect(lines.at(-1)).toContain('it changed on the repository');
    });

    it('fails the game whose file does not match the manifest, not the others', async () => {
        const pack = starterPack();
        const companion = pack.companion as {files: StartingPackFileEntry[]};
        companion.files.filter(file => file.name === 'roms/beta.zip').forEach((file) => {
            file.crc32 += 1;
        });

        expect(await run(pack)).toBe(false);

        expect(existsSync(join(home, 'roms', 'beta.zip'))).toBe(false);
        expect([...games.keys()]).toEqual(['alpha']);
        expect(lines.some(line => line.startsWith('[import] ERROR: beta: roms/beta.zip: does not match'))).toBe(true);
    });

    it('streams a file too big to be held in memory', async () => {
        const big = randomBytes(9 * 1024 * 1024);
        const pack = buildPack({'roms/big.zip': big}, {
            formatVersion: 1, generatedAt: '2026-09-20T11:55:30.726Z', games: [game('big', {hasMarquee: false})], biosRoms: [],
        });

        expect(await run(pack)).toBe(true);

        expect(readFileSync(join(home, 'roms', 'big.zip')).equals(big)).toBe(true);
        expect(existsSync(join(home, 'roms', 'big.zip.part'))).toBe(false);
    });

    it('reports the refusal of the repository', async () => {
        const pack = starterPack();
        const refusing = (async () => new Response(JSON.stringify({code: 'cabinet_disabled'}), {
            status: 403, headers: {'Content-Type': 'application/problem+json'},
        })) as unknown as typeof fetch;

        expect(await run(pack, {fetchImpl: refusing})).toBe(false);

        expect(lines.at(-1)).toBe('[import] Cannot read the pack: HTTP 403, refused by MAUI-API (cabinet_disabled)');
    });

    it('gives up when the repository ignores ranges', async () => {
        const pack = starterPack();
        const whole = (async () => new Response(new Uint8Array(pack.file), {status: 200})) as unknown as typeof fetch;

        expect(await run(pack, {fetchImpl: whole})).toBe(false);

        expect(lines.at(-1)).toContain('does not support HTTP Range requests');
    });

    it('needs the mame folders a pack of games goes to', async () => {
        targets.romPath = null;

        expect(await run(starterPack())).toBe(false);

        expect(lines.at(-1)).toContain('Incomplete MAME configuration, import impossible - missing: roms path');
    });
});

describe('describePack', () => {
    it('is null for a manifest written before the repository described the files', () => {
        expect(describePack({formatVersion: 1, generatedAt: '', games: [], biosRoms: []})).toBeNull();
        expect(describePack(null)).toBeNull();
        expect(describePack({zip: {size: 10}, files: [{name: 'a', offset: 0}]})).toBeNull();
    });

    it('refuses a pack whose own manifest the repository could not read', () => {
        const file = {name: 'manifest.json', offset: 30, compressedSize: 2, size: 2, method: 0, crc32: 1};

        expect(() => describePack({formatVersion: null, note: 'unrecognized formatVersion 2', zip: {size: 99}, files: [file]}))
            .toThrow('Invalid pack: unrecognized formatVersion 2.');
    });
});
