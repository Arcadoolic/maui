// Type-only contract for the manifest of a starting pack, as read by src/boServer.ts and
// scripts/import-starting-pack.py. The packs are built by tooling that lives outside this
// repository and carries its own copy of this file: this one is the reference for what the app
// accepts, so a change to the manifest shape must be mirrored there (and bump formatVersion
// when older packs would no longer import).

export interface StartingPackGameEntry {
    romName: string;
    fullname: string;
    shortname: string;
    subname: string;
    manufacturer: string | null;
    year: string | null;
    // Resolved by category NAME, never by Category.id_category: that numeric id depends on
    // genre.ini's key order at seed time and isn't guaranteed portable across installs.
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
