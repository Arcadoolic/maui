import {describe, it, expect, vi} from 'vitest';
import {avatarForUpload, fitsUploadLimits, pngSize, shrunkSize, MAX_UPLOAD_BYTES} from '@/class/AvatarForUpload';

/** The first bytes of a PNG of this size, padded to `bytes`: enough for pngSize(). */
function png(width: number, height: number, bytes = 64): Uint8Array {
    const buffer = Buffer.alloc(bytes);
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buffer);
    buffer.writeUInt32BE(13, 8);
    buffer.write('IHDR', 12, 'ascii');
    buffer.writeUInt32BE(width, 16);
    buffer.writeUInt32BE(height, 20);
    return new Uint8Array(buffer);
}

describe('pngSize', () => {
    it('reads the size of a PNG, and nothing from another file', () => {
        expect(pngSize(png(1024, 1536))).toEqual({width: 1024, height: 1536});
        expect(pngSize(new Uint8Array(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>')))).toBeNull();
    });
});

describe('fitsUploadLimits', () => {
    it('accepts 256 KB and 1024 px at most', () => {
        expect(fitsUploadLimits(png(256, 256))).toBe(true);
        expect(fitsUploadLimits(png(1024, 1536))).toBe(false);
        expect(fitsUploadLimits(png(256, 256, MAX_UPLOAD_BYTES + 1))).toBe(false);
    });
});

describe('shrunkSize', () => {
    it('brings the longest side to the size asked, proportions kept', () => {
        expect(shrunkSize(1024, 1536, 512)).toEqual({width: 341, height: 512});
        expect(shrunkSize(2000, 1000, 512)).toEqual({width: 512, height: 256});
    });
});

describe('avatarForUpload', () => {
    it('sends a small PNG as it is', () => {
        const resize = vi.fn();
        const small = png(256, 256);

        const upload = avatarForUpload(small, resize);

        expect(upload?.png).toBe(small);
        expect(upload?.hash).toMatch(/^[0-9a-f]{64}$/);
        expect(resize).not.toHaveBeenCalled();
    });

    it('scales a big one down first', () => {
        const shrunk = png(341, 512);
        const resize = vi.fn(() => shrunk);

        const upload = avatarForUpload(png(1024, 1536, 3_000_000), resize);

        expect(resize).toHaveBeenCalledWith(expect.anything(), 341, 512);
        expect(upload?.png).toBe(shrunk);
    });

    it('tries smaller sizes until the PNG weighs 256 KB at most', () => {
        // As NOB.png: 334 KB at 512 px, 193 KB at 384 px.
        const resize = vi.fn((source: Uint8Array, width: number, height: number) => png(width, height, height === 512 ? 333_770 : 193_377));

        const upload = avatarForUpload(png(1024, 1536, 3_000_000), resize);

        expect(resize.mock.calls.map(([, width, height]) => [width, height])).toEqual([[341, 512], [256, 384]]);
        expect(upload?.png.byteLength).toBe(193_377);
    });

    it('gives up on what is not a PNG, or too big at every size', () => {
        expect(avatarForUpload(new Uint8Array([1, 2, 3]), vi.fn())).toBeNull();
        expect(avatarForUpload(png(2000, 2000), (source, width, height) => png(width, height, MAX_UPLOAD_BYTES + 1))).toBeNull();
    });
});
