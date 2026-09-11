// Type-only contract shared between scripts/build-starting-pack.ts (producer) and
// src/boServer.ts (consumer). Unlike the rest of this codebase's mame-ini/path-resolution
// helpers - deliberately duplicated everywhere rather than imported, to avoid pulling
// @electron/remote into electron-free contexts - this file is pure interfaces, erased at
// compile time, so importing it carries none of that risk. Sharing it keeps producer and
// consumer from silently drifting apart on the manifest shape.

export interface StartingPackGameEntry {
    romName: string;
    fullname: string;
    shortname: string;
    subname: string;
    manufacturer: string | null;
    year: string | null;
    // Resolved by category NAME, never by Category.id_category: that numeric id depends on
    // genre_206.ini's key order at seed time and isn't guaranteed portable across installs.
    categoryName: string | null;
    player_alt: number;
    player_sim: number;
    // Name of the separate BIOS romset this game needs (mame -lx's `romof` attribute), e.g.
    // "neogeo" - null when the game is self-contained.
    biosName: string | null;
    hasRomFile: boolean;
    hasMarquee: boolean;
    hasFlyer: boolean;
    // Added after formatVersion 1 packs were already in the wild - optional so an older pack
    // (missing the field entirely, and with no logos/ entries in its ZIP) still imports fine,
    // just without logos, same as a game missing a rom/marquee/flyer would.
    hasLogo?: boolean;
}

export interface StartingPackManifest {
    formatVersion: 1;
    generatedAt: string;
    games: StartingPackGameEntry[];
    // Deduplicated BIOS romNames bundled under roms/ (one physical file even when several
    // games in `games` share the same BIOS).
    biosRoms: string[];
}
