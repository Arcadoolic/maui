import {createHash} from 'crypto';

// The avatar a cabinet sends to MAUI-API (maui-api D53): a PNG of 256 KB and 1024 px at most.
// Avatars set from the BO can be photos of several megabytes: they are scaled down first, to the
// largest of SHRUNK_DIMENSIONS (longest side) that fits, which is plenty for the round pictures of
// the hiscore screens. A photo at 512 px can still weigh over 256 KB as a PNG, hence several
// sizes. Small ones are sent as they are, byte for byte.

export const MAX_UPLOAD_BYTES = 256 * 1024;
export const MAX_UPLOAD_DIMENSION = 1024;
export const SHRUNK_DIMENSIONS = [512, 384, 256, 192, 128] as const;

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Width and height of a PNG, read from its IHDR chunk; null for anything else. */
export function pngSize(png: Uint8Array): {width: number; height: number} | null {
    const buffer = Buffer.from(png.buffer, png.byteOffset, png.byteLength);
    if (buffer.length < 24 || !buffer.subarray(0, 8).equals(PNG_SIGNATURE) || buffer.toString('ascii', 12, 16) !== 'IHDR') {
        return null;
    }
    return {width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20)};
}

export function fitsUploadLimits(png: Uint8Array): boolean {
    const size = pngSize(png);
    return size !== null && png.byteLength <= MAX_UPLOAD_BYTES
        && size.width <= MAX_UPLOAD_DIMENSION && size.height <= MAX_UPLOAD_DIMENSION;
}

/** The size of a picture scaled down to `longestSide`, proportions kept. */
export function shrunkSize(width: number, height: number, longestSide: number): {width: number; height: number} {
    const ratio = longestSide / Math.max(width, height);
    return {width: Math.max(1, Math.round(width * ratio)), height: Math.max(1, Math.round(height * ratio))};
}

export type PngResizer = (png: Uint8Array, width: number, height: number) => Uint8Array;

/**
 * The PNG to send for a local avatar, with its SHA-256: the file itself when it fits MAUI-API's
 * limits, a scaled-down copy otherwise. Null when it is not a PNG or still does not fit.
 */
export function avatarForUpload(png: Uint8Array, resize: PngResizer): {png: Uint8Array; hash: string} | null {
    const size = pngSize(png);
    if (size === null) {
        return null;
    }
    let upload: Uint8Array | null = fitsUploadLimits(png) ? png : null;
    for (const longestSide of upload ? [] : SHRUNK_DIMENSIONS) {
        const target = shrunkSize(size.width, size.height, longestSide);
        const shrunk = resize(png, target.width, target.height);
        if (fitsUploadLimits(shrunk)) {
            upload = shrunk;
            break;
        }
    }
    return upload ? {png: upload, hash: createHash('sha256').update(upload).digest('hex')} : null;
}
