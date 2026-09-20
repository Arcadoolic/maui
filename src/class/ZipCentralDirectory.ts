const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_ENTRY_SIGNATURE = 0x02014b50;
const EOCD_MIN_LENGTH = 22;
const CENTRAL_ENTRY_MIN_LENGTH = 46;
// ZIP64 marker in a 32-bit field: the real value sits in an extra record this parser ignores.
const ZIP64_MARKER = 0xffffffff;
// A ZIP comment is at most 65535 bytes, so the end-of-central-directory record is always within
// this many bytes of the end of the file.
export const ZIP_TAIL_LENGTH = 65535 + EOCD_MIN_LENGTH;

export interface ZipEndRecord {
    entryCount: number;
    directoryOffset: number;
    directorySize: number;
}

/**
 * Locates the end-of-central-directory record in the last bytes of a ZIP file. null when there is
 * none (not a ZIP) or when the archive is ZIP64 (sizes/offsets that do not fit 32 bits): callers
 * then just go without per-entry sizes.
 */
export function findZipEndRecord(tail: Buffer): ZipEndRecord | null {
    for (let position = tail.length - EOCD_MIN_LENGTH; position >= 0; position--) {
        if (tail.readUInt32LE(position) !== EOCD_SIGNATURE) {
            continue;
        }
        const entryCount = tail.readUInt16LE(position + 10);
        const directorySize = tail.readUInt32LE(position + 12);
        const directoryOffset = tail.readUInt32LE(position + 16);
        if (directoryOffset === ZIP64_MARKER || directorySize === ZIP64_MARKER || entryCount === 0xffff) {
            return null;
        }
        return {entryCount, directoryOffset, directorySize};
    }
    return null;
}

/**
 * Uncompressed size of every file entry of a ZIP, from its central directory alone (the bytes
 * `directorySize` long starting at `directoryOffset`). That is the space each entry takes once
 * extracted. null if the directory is truncated/corrupt or holds a ZIP64 entry.
 */
export function parseZipEntrySizes(directory: Buffer): Map<string, number> | null {
    const sizes = new Map<string, number>();
    let position = 0;
    while (position + 4 <= directory.length && directory.readUInt32LE(position) === CENTRAL_ENTRY_SIGNATURE) {
        if (position + CENTRAL_ENTRY_MIN_LENGTH > directory.length) {
            return null;
        }
        const size = directory.readUInt32LE(position + 24);
        const nameLength = directory.readUInt16LE(position + 28);
        const extraLength = directory.readUInt16LE(position + 30);
        const commentLength = directory.readUInt16LE(position + 32);
        const nameEnd = position + CENTRAL_ENTRY_MIN_LENGTH + nameLength;
        if (nameEnd > directory.length || size === ZIP64_MARKER) {
            return null;
        }
        const name = directory.toString('utf8', position + CENTRAL_ENTRY_MIN_LENGTH, nameEnd);
        if (!name.endsWith('/')) {
            sizes.set(name, size);
        }
        position = nameEnd + extraLength + commentLength;
    }
    return sizes;
}

/**
 * Entry sizes of a remote ZIP, read with two small HTTP Range requests (its last ~64 KiB, then the
 * central directory if that is not already inside) instead of downloading it. null on any failure
 * or when the server ignores ranges: the caller falls back to an estimate.
 */
export async function fetchRemoteZipEntrySizes(
    url: string, headers: Record<string, string>, fetchImpl: typeof fetch = fetch,
): Promise<Map<string, number> | null> {
    try {
        const tailResponse = await fetchImpl(url, {
            headers: {...headers, Range: `bytes=-${ZIP_TAIL_LENGTH}`},
            signal: AbortSignal.timeout(10_000),
        });
        // 200 = the server ignored the range and is sending the whole file: not worth reading.
        if (tailResponse.status !== 206) {
            await tailResponse.body?.cancel();
            return null;
        }
        const tail = Buffer.from(await tailResponse.arrayBuffer());
        const total = Number(/\/(\d+)$/.exec(tailResponse.headers.get('Content-Range') ?? '')?.[1]);
        const end = findZipEndRecord(tail);
        if (!end || !Number.isFinite(total)) {
            return null;
        }
        const tailStart = total - tail.length;
        if (end.directoryOffset >= tailStart) {
            const start = end.directoryOffset - tailStart;
            return parseZipEntrySizes(tail.subarray(start, start + end.directorySize));
        }
        const directoryResponse = await fetchImpl(url, {
            headers: {...headers, Range: `bytes=${end.directoryOffset}-${end.directoryOffset + end.directorySize - 1}`},
            signal: AbortSignal.timeout(10_000),
        });
        if (directoryResponse.status !== 206) {
            await directoryResponse.body?.cancel();
            return null;
        }
        return parseZipEntrySizes(Buffer.from(await directoryResponse.arrayBuffer()));
    } catch {
        return null;
    }
}
