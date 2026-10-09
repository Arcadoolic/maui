import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {mkdtempSync, rmSync, readdirSync, readFileSync, writeFileSync} from 'fs';
import {join} from 'path';
import {tmpdir} from 'os';
import {
    generateDefaultAvatarSvg, generateDefaultAvatarPng, ensureDefaultAvatar, replaceSvgDefaultAvatars,
    isDefaultAvatar, resetToDefaultAvatar,
} from '@/class/DefaultAvatar';
import {pngSize} from '@/class/AvatarForUpload';
import {findAvatarFile} from '@/class/AvatarFiles';

describe('generateDefaultAvatarSvg', () => {
    it('renders a standalone SVG document', () => {
        const svg = generateDefaultAvatarSvg('ABC');
        expect(svg.startsWith('<svg')).toBe(true);
        expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
        expect(svg.endsWith('</svg>')).toBe(true);
    });

    it('always gives the same avatar to the same pseudo, and another one to another pseudo', () => {
        expect(generateDefaultAvatarSvg('ABC')).toBe(generateDefaultAvatarSvg('ABC'));
        expect(generateDefaultAvatarSvg('ABC')).not.toBe(generateDefaultAvatarSvg('ABD'));
    });
});

describe('generateDefaultAvatarPng', () => {
    it('renders a square PNG', () => {
        expect(pngSize(generateDefaultAvatarPng('ABC'))).toEqual({width: 256, height: 256});
    });

    it('always gives the same picture to the same pseudo, and another one to another pseudo', () => {
        const png = Buffer.from(generateDefaultAvatarPng('ABC'));
        expect(png.equals(Buffer.from(generateDefaultAvatarPng('ABC')))).toBe(true);
        expect(png.equals(Buffer.from(generateDefaultAvatarPng('ABD')))).toBe(false);
    });
});

describe('ensureDefaultAvatar', () => {
    let dir: string;

    beforeEach(() => {
        dir = mkdtempSync(join(tmpdir(), 'maui-avatars-'));
    });

    afterEach(() => {
        rmSync(dir, {recursive: true, force: true});
    });

    it('writes <pseudo>.png for a player who has no avatar', () => {
        expect(ensureDefaultAvatar(dir, 'ABC')).toBe('ABC.png');
        expect(readdirSync(dir)).toEqual(['ABC.png']);
        expect(readFileSync(join(dir, 'ABC.png')).equals(Buffer.from(generateDefaultAvatarPng('ABC')))).toBe(true);
    });

    it('never replaces an existing avatar', () => {
        writeFileSync(join(dir, 'PNG.png'), 'uploaded');
        expect(ensureDefaultAvatar(dir, 'PNG')).toBeNull();
        expect(readFileSync(join(dir, 'PNG.png'), 'utf8')).toBe('uploaded');
        expect(readdirSync(dir)).toEqual(['PNG.png']);
    });

    it('does nothing without a usable avatars directory', () => {
        expect(ensureDefaultAvatar(undefined, 'ABC')).toBeNull();
        expect(ensureDefaultAvatar(join(dir, 'missing'), 'ABC')).toBeNull();
    });

    it('refuses a pseudo that is not a plain filename', () => {
        expect(ensureDefaultAvatar(dir, '../evil')).toBeNull();
        expect(ensureDefaultAvatar(dir, 'a/b')).toBeNull();
        expect(ensureDefaultAvatar(dir, '')).toBeNull();
        expect(readdirSync(dir)).toEqual([]);
    });
});

describe('replaceSvgDefaultAvatars', () => {
    let dir: string;

    beforeEach(() => {
        dir = mkdtempSync(join(tmpdir(), 'maui-avatars-'));
    });

    afterEach(() => {
        rmSync(dir, {recursive: true, force: true});
    });

    it('replaces an SVG default by the PNG one, and keeps a PNG uploaded since', () => {
        writeFileSync(join(dir, 'OLD.svg'), '<svg/>');
        writeFileSync(join(dir, 'UPL.svg'), '<svg/>');
        writeFileSync(join(dir, 'UPL.png'), 'uploaded');
        writeFileSync(join(dir, 'PNG.png'), 'uploaded');

        expect(replaceSvgDefaultAvatars(dir)).toEqual(['OLD']);

        expect(readdirSync(dir).sort()).toEqual(['OLD.png', 'PNG.png', 'UPL.png']);
        expect(readFileSync(join(dir, 'OLD.png')).equals(Buffer.from(generateDefaultAvatarPng('OLD')))).toBe(true);
        expect(readFileSync(join(dir, 'UPL.png'), 'utf8')).toBe('uploaded');
    });

    it('does nothing without a usable avatars directory', () => {
        expect(replaceSvgDefaultAvatars(undefined)).toEqual([]);
        expect(replaceSvgDefaultAvatars(join(dir, 'missing'))).toEqual([]);
    });
});

describe('resetToDefaultAvatar', () => {
    let dir: string;

    beforeEach(() => {
        dir = mkdtempSync(join(tmpdir(), 'maui-avatars-'));
    });

    afterEach(() => {
        rmSync(dir, {recursive: true, force: true});
    });

    it('replaces a picture by the default avatar', () => {
        writeFileSync(join(dir, 'ABC.png'), 'uploaded');
        expect(isDefaultAvatar(dir, 'ABC')).toBe(false);

        expect(resetToDefaultAvatar(dir, 'ABC')).toBe(true);

        expect(isDefaultAvatar(dir, 'ABC')).toBe(true);
        expect(readdirSync(dir)).toEqual(['ABC.png']);
    });

    it('does nothing for the default avatar, a missing one or an unsafe pseudo', () => {
        ensureDefaultAvatar(dir, 'ABC');
        expect(resetToDefaultAvatar(dir, 'ABC')).toBe(false);
        expect(resetToDefaultAvatar(dir, 'NOP')).toBe(false);
        expect(isDefaultAvatar(dir, 'NOP')).toBe(false);
        expect(resetToDefaultAvatar(dir, '../evil')).toBe(false);
        expect(readdirSync(dir)).toEqual(['ABC.png']);
    });
});

describe('findAvatarFile', () => {
    it('finds the PNG of a player, and nothing else', () => {
        expect(findAvatarFile(['ABC.png'], 'ABC')).toBe('ABC.png');
        expect(findAvatarFile(['ABC.svg'], 'ABC')).toBeUndefined();
    });

    it('returns undefined when the player has none, and does not match another pseudo', () => {
        expect(findAvatarFile(['ABCD.png', 'XABC.png'], 'ABC')).toBeUndefined();
        expect(findAvatarFile([], 'ABC')).toBeUndefined();
    });
});
