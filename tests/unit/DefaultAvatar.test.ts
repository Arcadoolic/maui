import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {mkdtempSync, rmSync, readdirSync, readFileSync, writeFileSync} from 'fs';
import {join} from 'path';
import {tmpdir} from 'os';
import {generateDefaultAvatarSvg, ensureDefaultAvatar} from '@/class/DefaultAvatar';
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

describe('ensureDefaultAvatar', () => {
    let dir: string;

    beforeEach(() => {
        dir = mkdtempSync(join(tmpdir(), 'maui-avatars-'));
    });

    afterEach(() => {
        rmSync(dir, {recursive: true, force: true});
    });

    it('writes <pseudo>.svg for a player who has no avatar', () => {
        expect(ensureDefaultAvatar(dir, 'ABC')).toBe('ABC.svg');
        expect(readdirSync(dir)).toEqual(['ABC.svg']);
        expect(readFileSync(join(dir, 'ABC.svg'), 'utf8')).toBe(generateDefaultAvatarSvg('ABC'));
    });

    it('never replaces an existing avatar, PNG or SVG', () => {
        writeFileSync(join(dir, 'PNG.png'), 'uploaded');
        writeFileSync(join(dir, 'SVG.svg'), 'earlier');
        expect(ensureDefaultAvatar(dir, 'PNG')).toBeNull();
        expect(ensureDefaultAvatar(dir, 'SVG')).toBeNull();
        expect(readFileSync(join(dir, 'PNG.png'), 'utf8')).toBe('uploaded');
        expect(readFileSync(join(dir, 'SVG.svg'), 'utf8')).toBe('earlier');
        expect(readdirSync(dir).sort()).toEqual(['PNG.png', 'SVG.svg']);
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

describe('findAvatarFile', () => {
    it('finds a PNG or an SVG, the PNG winning when both exist', () => {
        expect(findAvatarFile(['ABC.svg'], 'ABC')).toBe('ABC.svg');
        expect(findAvatarFile(['ABC.png'], 'ABC')).toBe('ABC.png');
        expect(findAvatarFile(['ABC.svg', 'ABC.png'], 'ABC')).toBe('ABC.png');
    });

    it('returns undefined when the player has none, and does not match another pseudo', () => {
        expect(findAvatarFile(['ABCD.png', 'XABC.svg'], 'ABC')).toBeUndefined();
        expect(findAvatarFile([], 'ABC')).toBeUndefined();
    });
});
