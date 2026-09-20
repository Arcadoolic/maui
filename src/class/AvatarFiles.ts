import {rmSync} from 'fs';
import {join} from 'path';

/**
 * Avatars live as `<pseudo_3>.<ext>` files in Config.avatarsPath. A player either uploaded a PNG
 * (BO Players tab) or was given a generated default one (`.svg`, see DefaultAvatar.ts) - the PNG
 * wins when both exist, so uploading one replaces the default without deleting anything.
 * Kept free of any heavy import: the Vue views only need this lookup, not the generator.
 */
export const AVATAR_EXTENSIONS = ['png', 'svg'] as const;

// Pseudos are 3 letters in the app and 3 alphanumerics in the BO, but existing avatar files also
// carry suffixes such as "GUS_1": anything else could not be a plain filename, and is never
// turned into a path (a pseudo such as "../" must not reach outside the avatars directory).
const SAFE_PSEUDO = /^[\w-]+$/;

export function isSafePseudo(pseudo3: string): boolean {
    return SAFE_PSEUDO.test(pseudo3);
}

/** The avatar filename to show for `pseudo3` among `avatarFilenames`, if it has one. */
export function findAvatarFile(avatarFilenames: string[], pseudo3: string): string | undefined {
    return AVATAR_EXTENSIONS.map(extension => `${pseudo3}.${extension}`)
        .find(filename => avatarFilenames.includes(filename));
}

/** Deletes every avatar file (`<pseudo3>.png` / `.svg`) of `pseudo3`; a missing one is fine. */
export function removeAvatarFiles(avatarsPath: string | undefined, pseudo3: string): void {
    if (!avatarsPath || !isSafePseudo(pseudo3)) {
        return;
    }
    for (const extension of AVATAR_EXTENSIONS) {
        rmSync(join(avatarsPath, `${pseudo3}.${extension}`), {force: true});
    }
}
