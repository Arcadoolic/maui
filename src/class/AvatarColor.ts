// The background of a player's round avatar on the marquees (Champions.vue): one of a few bright
// colors, picked from the player's initials, so it looks random but a player keeps the same one
// from a game to the next and through every refresh of the scores.
export const AVATAR_COLORS: readonly string[] = [
    '#e63946', '#f4a261', '#e9c46a', '#2a9d8f', '#43aa8b', '#4cc9f0',
    '#4361ee', '#7209b7', '#b5179e', '#f72585', '#ff6d00', '#8ac926',
];

export function avatarColor(pseudo3: string): string {
    let hash = 0;
    for (const char of pseudo3.toUpperCase()) {
        hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
    }
    return AVATAR_COLORS[hash % AVATAR_COLORS.length];
}
