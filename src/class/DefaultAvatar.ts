import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import Avatar from 'boring-avatars';
import {Resvg} from '@resvg/resvg-js';
import {existsSync, readdirSync, readFileSync, rmSync, writeFileSync} from 'fs';
import {join} from 'path';
import {findAvatarFile, isSafePseudo} from '@/class/AvatarFiles';

// Arcade-bright colors that stand out on the dark UI (same family as the BO's accent colors).
const AVATAR_COLORS = ['#ff6b6b', '#6bff8a', '#8ab4f8', '#ffd166', '#c77dff'];

// Side of the generated picture, in pixels: sharp at the largest size the front shows an avatar.
const AVATAR_SIZE = 256;

/**
 * The default avatar of a player, as a standalone SVG document: Boring Avatars' "beam" variant
 * (a small face), seeded by the pseudo so it is always the same one for a given pseudo.
 * Square, since the views round every avatar themselves (border-radius), as they do for uploads.
 */
export function generateDefaultAvatarSvg(pseudo3: string): string {
    return renderToStaticMarkup(createElement(Avatar, {
        name: pseudo3, variant: 'beam', size: AVATAR_SIZE, square: true, colors: AVATAR_COLORS,
    }));
}

/**
 * The same default avatar as a PNG, the only format avatars are kept in: an uploaded one is a
 * PNG too, and MAUI-API only takes PNGs (see boCore.ts's readLocalAvatar()).
 */
export function generateDefaultAvatarPng(pseudo3: string): Uint8Array {
    return new Resvg(generateDefaultAvatarSvg(pseudo3)).render().asPng();
}

/**
 * Gives `pseudo3` its default avatar, written to `<avatarsPath>/<pseudo3>.png`, unless it already
 * has an avatar (an existing one is never replaced). Returns the filename written, or null when
 * nothing was.
 */
export function ensureDefaultAvatar(avatarsPath: string | undefined, pseudo3: string): string | null {
    if (!avatarsPath || !existsSync(avatarsPath) || !isSafePseudo(pseudo3)) {
        return null;
    }
    if (findAvatarFile(readdirSync(avatarsPath), pseudo3)) {
        return null;
    }
    const filename = `${pseudo3}.png`;
    writeFileSync(join(avatarsPath, filename), generateDefaultAvatarPng(pseudo3));
    return filename;
}

/** Whether the avatar file of `pseudo3` is its generated default, not a picture given to it. */
export function isDefaultAvatar(avatarsPath: string, pseudo3: string): boolean {
    try {
        return readFileSync(join(avatarsPath, `${pseudo3}.png`)).equals(generateDefaultAvatarPng(pseudo3));
    } catch {
        return false;
    }
}

/**
 * Takes the picture of `pseudo3` away: its generated default avatar comes back in its place.
 * Returns false when there was nothing to take away (no avatar, or the default one already).
 */
export function resetToDefaultAvatar(avatarsPath: string, pseudo3: string): boolean {
    if (!isSafePseudo(pseudo3) || !existsSync(join(avatarsPath, `${pseudo3}.png`)) || isDefaultAvatar(avatarsPath, pseudo3)) {
        return false;
    }
    writeFileSync(join(avatarsPath, `${pseudo3}.png`), generateDefaultAvatarPng(pseudo3));
    return true;
}

/**
 * Default avatars used to be written as `<pseudo3>.svg` files, which are no longer shown: each
 * one is replaced by the PNG default of its player, or just deleted when the player has uploaded
 * a PNG since. Run once when the app starts (boCore.ts); returns the pseudos given a PNG.
 */
export function replaceSvgDefaultAvatars(avatarsPath: string | undefined): string[] {
    if (!avatarsPath || !existsSync(avatarsPath)) {
        return [];
    }
    const replaced: string[] = [];
    for (const filename of readdirSync(avatarsPath).filter(name => name.endsWith('.svg'))) {
        const pseudo3 = filename.slice(0, -'.svg'.length);
        if (ensureDefaultAvatar(avatarsPath, pseudo3)) {
            replaced.push(pseudo3);
        }
        rmSync(join(avatarsPath, filename), {force: true});
    }
    return replaced;
}
