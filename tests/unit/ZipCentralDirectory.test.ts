import {describe, it, expect} from 'vitest';
import AdmZip from 'adm-zip';
import {fetchRemoteZipEntrySizes, findZipEndRecord, parseZipEntrySizes, ZIP_TAIL_LENGTH} from '@/class/ZipCentralDirectory';

function buildZip(entries: {[name: string]: number}): Buffer {
    const zip = new AdmZip();
    for (const [name, size] of Object.entries(entries)) {
        zip.addFile(name, Buffer.alloc(size, 7));
    }
    return zip.toBuffer();
}

function directoryOf(zipFile: Buffer) {
    const end = findZipEndRecord(zipFile.subarray(Math.max(0, zipFile.length - ZIP_TAIL_LENGTH)));
    if (!end) {
        throw new Error('no end record');
    }
    return zipFile.subarray(end.directoryOffset, end.directoryOffset + end.directorySize);
}

describe('zip central directory', () => {
    const entries = {'roms/alpha.zip': 3000, 'marquees/alpha.png': 120, 'manifest.json': 40};

    it('reads the uncompressed size of every entry from the directory alone', () => {
        const sizes = parseZipEntrySizes(directoryOf(buildZip(entries)));

        expect(Object.fromEntries(sizes ?? [])).toEqual(entries);
    });

    it('finds the end record even behind a zip comment', () => {
        const zip = new AdmZip();
        zip.addFile('a.txt', Buffer.from('hello'));
        zip.addZipComment('some comment');

        expect(findZipEndRecord(zip.toBuffer())?.entryCount).toBe(1);
    });

    it('returns null when there is no directory to read', () => {
        expect(findZipEndRecord(Buffer.from('not a zip at all, just text'))).toBeNull();
        expect(parseZipEntrySizes(Buffer.from('garbage'))?.size).toBe(0);
    });

    describe('fetchRemoteZipEntrySizes', () => {
        const file = buildZip(entries);
        const rangeServer = (log: string[], honourRanges = true) => (async (_url: unknown, init?: RequestInit) => {
            const range = (init?.headers as Record<string, string>).Range;
            log.push(range);
            if (!honourRanges) {
                return new Response(new Uint8Array(file), {status: 200});
            }
            const match = /^bytes=(\d*)-(\d*)$/.exec(range);
            const start = match?.[1] ? Number(match[1]) : Math.max(0, file.length - Number(match?.[2]));
            const end = match?.[1] && match[2] ? Number(match[2]) : file.length - 1;
            return new Response(new Uint8Array(file.subarray(start, end + 1)), {
                status: 206, headers: {'Content-Range': `bytes ${start}-${end}/${file.length}`},
            });
        }) as unknown as typeof fetch;

        it('gets the sizes with one range request when the directory is in the tail', async () => {
            const log: string[] = [];

            const sizes = await fetchRemoteZipEntrySizes('http://repo/pack.zip', {}, rangeServer(log));

            expect(Object.fromEntries(sizes ?? [])).toEqual(entries);
            expect(log).toEqual([`bytes=-${ZIP_TAIL_LENGTH}`]);
        });

        it('fetches the directory separately when it is larger than the tail', async () => {
            const many = Object.fromEntries(Array.from({length: 1500}, (_, i) => [`roms/game-with-a-long-name-${i}.zip`, i + 1]));
            const bigFile = buildZip(many);
            const log: string[] = [];
            const server = (async (_url: unknown, init?: RequestInit) => {
                const range = (init?.headers as Record<string, string>).Range;
                log.push(range);
                const match = /^bytes=(\d*)-(\d*)$/.exec(range);
                const start = match?.[1] ? Number(match[1]) : Math.max(0, bigFile.length - Number(match?.[2]));
                const end = match?.[1] && match[2] ? Number(match[2]) : bigFile.length - 1;
                return new Response(new Uint8Array(bigFile.subarray(start, end + 1)), {
                    status: 206, headers: {'Content-Range': `bytes ${start}-${end}/${bigFile.length}`},
                });
            }) as unknown as typeof fetch;

            const sizes = await fetchRemoteZipEntrySizes('http://repo/big.zip', {}, server);

            expect(Object.fromEntries(sizes ?? [])).toEqual(many);
            expect(log).toHaveLength(2);
            expect(log[1]).toMatch(/^bytes=\d+-\d+$/);
        });

        it('gives up when the server ignores ranges, instead of reading the whole file', async () => {
            expect(await fetchRemoteZipEntrySizes('http://repo/pack.zip', {}, rangeServer([], false))).toBeNull();
        });

        it('gives up on a network error', async () => {
            const failing = (() => Promise.reject(new Error('down'))) as unknown as typeof fetch;

            expect(await fetchRemoteZipEntrySizes('http://repo/pack.zip', {}, failing)).toBeNull();
        });
    });
});
