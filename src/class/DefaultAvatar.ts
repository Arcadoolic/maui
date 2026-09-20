import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import Avatar from 'boring-avatars';
import {existsSync, readdirSync, writeFileSync} from 'fs';
import {join} from 'path';
import {findAvatarFile, isSafePseudo} from '@/class/AvatarFiles';

// Arcade-bright colors that stand out on the dark UI (same family as the BO's accent colors).
const AVATAR_COLORS = ['#ff6b6b', '#6bff8a', '#8ab4f8', '#ffd166', '#c77dff'];

/**
 * The default avatar of a player, as a standalone SVG document: Boring Avatars' "pixel" variant
 * (a fitting retro look), seeded by the pseudo so it is always the same one for a given pseudo.
 * Square, since the views round every avatar themselves (border-radius), as they do for PNGs.
 */
export function generateDefaultAvatarSvg(pseudo3: string): string {
    return renderToStaticMarkup(createElement(Avatar, {
        name: pseudo3, variant: 'pixel', size: 128, square: true, colors: AVATAR_COLORS,
    }));
}

/**
 * Gives `pseudo3` its default avatar, written to `<avatarsPath>/<pseudo3>.svg`, unless it already
 * has an avatar of any kind (an existing one is never replaced). Returns the filename written, or
 * null when nothing was.
 */
export function ensureDefaultAvatar(avatarsPath: string | undefined, pseudo3: string): string | null {
    if (!avatarsPath || !existsSync(avatarsPath) || !isSafePseudo(pseudo3)) {
        return null;
    }
    if (findAvatarFile(readdirSync(avatarsPath), pseudo3)) {
        return null;
    }
    const filename = `${pseudo3}.svg`;
    writeFileSync(join(avatarsPath, filename), generateDefaultAvatarSvg(pseudo3), 'utf8');
    return filename;
}
