import {describe, it, expect, vi, beforeEach, afterEach} from 'vitest';
import {createHash} from 'crypto';
import {existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'fs';
import {tmpdir} from 'os';
import {join} from 'path';
import {MediaSync, MEDIA_SYNC_EVERY_MS} from '@/class/MediaSync';
import type {ApiResult, Conditional, GameMediaHashes, MauiApiClient} from '@/class/MauiApiClient';

const sha = (content: string | Uint8Array): string => createHash('sha256').update(content).digest('hex');
const bytes = (content: string): Uint8Array => new Uint8Array(Buffer.from(content));

let dir: string;
beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'media-sync-'));
    for (const folder of ['marquees', 'flyers', 'logo']) {
        mkdirSync(join(dir, folder));
    }
});
afterEach(() => rmSync(dir, {recursive: true, force: true}));

/** The API's pictures: what GET /media lists, and the files GET /games/{rom}/media/{type} serves. */
function harness(files: { [romAndType: string]: string }, options: { romnames?: string[]; paused?: () => boolean } = {}) {
    let now = 1_000_000;
    const listing = (): GameMediaHashes => {
        const games: GameMediaHashes = {};
        for (const [key, content] of Object.entries(files)) {
            const [rom, type] = key.split('/') as [string, 'marquee' | 'flyer' | 'logo'];
            (games[rom] ??= {})[type] = sha(content);
        }
        return games;
    };
    const getMedia = vi.fn(async (etag: string | null): Promise<ApiResult<Conditional<GameMediaHashes>>> => {
        const body = listing();
        const tag = `"${sha(JSON.stringify(body))}"`;
        return etag === tag
            ? {kind: 'ok', value: {notModified: true}}
            : {kind: 'ok', value: {notModified: false, etag: tag, value: body}};
    });
    const getGameMedia = vi.fn(async (rom: string, type: string): Promise<ApiResult<Uint8Array>> => {
        const content = files[`${rom}/${type}`];
        return content === undefined
            ? {kind: 'rejected', status: 404, code: 'media_not_found'}
            : {kind: 'ok', value: bytes(content)};
    });
    const sync = new MediaSync({
        romnames: async () => options.romnames ?? ['pacman', 'tetris'],
        folders: () => ({marquee: join(dir, 'marquees'), flyer: join(dir, 'flyers'), logo: join(dir, 'logo')}),
        statePath: join(dir, 'media-sync.json'),
        paused: options.paused ?? (() => false),
        now: () => now,
    });
    const client = {getMedia, getGameMedia} as unknown as MauiApiClient;
    return {sync, client, getMedia, getGameMedia, files, later: (ms: number) => { now += ms; }};
}

const local = (folder: string, rom: string): string | null => {
    const file = join(dir, folder, `${rom}.png`);
    return existsSync(file) ? readFileSync(file, 'utf8') : null;
};

describe('MediaSync', () => {
    it('makes the pictures of the cabinet\'s games those of the API, and tells which games changed', async () => {
        writeFileSync(join(dir, 'marquees', 'pacman.png'), 'old marquee');
        writeFileSync(join(dir, 'logo', 'pacman.png'), 'pacman logo');
        writeFileSync(join(dir, 'logo', 'tetris.png'), 'my own logo');
        const h = harness({
            'pacman/marquee': 'new marquee', 'pacman/logo': 'pacman logo',
            'tetris/flyer': 'donor flyer', 'galaga/marquee': 'not a favorite',
        });
        const listener = vi.fn();
        h.sync.onChange(listener);

        const summary = await h.sync.sync(h.client);

        expect(summary.written.sort()).toEqual(['pacman/marquee', 'tetris/flyer']);
        expect(local('marquees', 'pacman')).toBe('new marquee');
        expect(local('flyers', 'tetris')).toBe('donor flyer');
        // The API has no logo of tetris: the cabinet's own stays.
        expect(local('logo', 'tetris')).toBe('my own logo');
        // Not a game of this cabinet.
        expect(local('marquees', 'galaga')).toBeNull();
        expect(h.getGameMedia).toHaveBeenCalledTimes(2);
        expect(listener).toHaveBeenCalledWith(['pacman', 'tetris']);
    });

    it('asks again only after a while, and downloads nothing when nothing changed', async () => {
        const h = harness({'pacman/marquee': 'm'});
        await h.sync.sync(h.client);

        expect((await h.sync.sync(h.client)).checked).toBe(false);
        expect(h.getMedia).toHaveBeenCalledTimes(1);

        h.later(MEDIA_SYNC_EVERY_MS);
        const again = await h.sync.sync(h.client);

        expect(again.checked).toBe(true);
        expect(again.written).toEqual([]);
        expect(h.getMedia).toHaveBeenCalledTimes(2);
        expect(h.getMedia.mock.calls[1][0]).toMatch(/^"/);
        expect(h.getGameMedia).toHaveBeenCalledTimes(1);
    });

    it('puts back a picture changed on the disk, and takes a new game at once', async () => {
        const h = harness({'pacman/marquee': 'm', 'mslug/flyer': 'f'}, {romnames: ['pacman']});
        await h.sync.sync(h.client);
        writeFileSync(join(dir, 'marquees', 'pacman.png'), 'changed by hand');

        const forced = await h.sync.sync(h.client, {force: true});

        expect(forced.written).toEqual(['pacman/marquee']);
        expect(local('marquees', 'pacman')).toBe('m');
    });

    it('stops while a game is played, and goes on next time', async () => {
        let playing = false;
        const h = harness({'pacman/marquee': 'm', 'tetris/marquee': 't'}, {paused: () => playing});
        h.getGameMedia.mockImplementationOnce(async () => {
            playing = true;
            return {kind: 'ok', value: bytes('m')};
        });

        const first = await h.sync.sync(h.client);

        expect(first.stoppedForGame).toBe(true);
        expect(first.written).toEqual(['pacman/marquee']);
        expect(local('marquees', 'tetris')).toBeNull();

        playing = false;
        const next = await h.sync.sync(h.client);

        expect(next.checked).toBe(true);
        expect(next.written).toEqual(['tetris/marquee']);
    });

    it('keeps the file it had when a download fails or differs from the hash', async () => {
        writeFileSync(join(dir, 'marquees', 'pacman.png'), 'old');
        const h = harness({'pacman/marquee': 'new', 'tetris/marquee': 't'});
        h.getGameMedia.mockImplementation(async (rom: string) => rom === 'pacman'
            ? {kind: 'ok', value: bytes('corrupted')}
            : {kind: 'unavailable', reason: 'network'});

        const summary = await h.sync.sync(h.client);

        expect(summary.written).toEqual([]);
        expect(summary.failed).toEqual(['pacman/marquee', 'tetris/marquee']);
        expect(local('marquees', 'pacman')).toBe('old');
        // Asked again at the next turn, not in 6 hours.
        expect((await h.sync.sync(h.client)).checked).toBe(true);
    });

    it('says why when the list cannot be had', async () => {
        const h = harness({});
        h.getMedia.mockResolvedValueOnce({kind: 'rejected', status: 403, code: 'insufficient_ability'});

        const summary = await h.sync.sync(h.client);

        expect(summary.failure).toEqual({kind: 'rejected', status: 403, code: 'insufficient_ability'});
        expect(h.getGameMedia).not.toHaveBeenCalled();
    });
});
