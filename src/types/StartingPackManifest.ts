// Type-only contract for the manifest of a starting pack, as read by src/boServer.ts,
// src/class/PackImport.ts and scripts/import-starting-pack.py. The packs are built by tooling that lives outside this
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
    // Publisher/developer as ScreenScraper names them (the app's roms-infos-cache.json on the
    // machine that built the pack), which mame's manufacturer doesn't tell apart (mslug: SNK /
    // Nazca). An import adds them to the cabinet's own cache, so its ScreenScraper download
    // never asks again for a game that came with its artwork. Absent from older packs.
    publisher?: string | null;
    publisherId?: string | null;
    developer?: string | null;
    developerId?: string | null;
    // Resolved by category NAME, never by Category.id_category: that numeric id depends on
    // genre.ini's key order at seed time and isn't guaranteed portable across installs.
    categoryName: string | null;
    player_alt: number;
    player_sim: number;
    // Name of the separate BIOS romset this game needs (mame -lx's `romof` attribute), e.g.
    // "neogeo" - null when the game is self-contained.
    biosName: string | null;
    // Every other romset the game needs to run, each bundled under roms/: its parent (a merged
    // clone has no zip of its own), the whole romof chain up to the BIOS, and the devices that
    // ship ROMs (qsound_hle, namco51...). Added after formatVersion 1 packs were in the wild:
    // absent from an older pack, where biosName is the only dependency known.
    requiredRoms?: string[];
    // Sample set the game plays some sounds from (mame's `sampleof`, e.g. qbert's knocker),
    // bundled at samples/<name>.zip and installed into the samplepath. null/absent when the game
    // uses none, or the pack was built without it (mame then runs the game without those sounds).
    sampleSet?: string | null;
    hasRomFile: boolean;
    hasMarquee: boolean;
    hasFlyer: boolean;
    // Added after formatVersion 1 packs were already in the wild - optional so an older pack
    // (missing the field entirely, and with no logos/ entries in its ZIP) still imports fine,
    // just without logos, same as a game missing a rom/marquee/flyer would.
    hasLogo?: boolean;
}

// Where one file of the pack sits in the ZIP: enough to pull it out with a single HTTP Range
// request (`offset` to `offset + compressedSize - 1`) and zlib, without reading the ZIP's
// central directory.
export interface StartingPackFileEntry {
    // Path inside the ZIP, e.g. "roms/sf2.zip".
    name: string;
    // Position of the entry's data in the ZIP, past its local header.
    offset: number;
    compressedSize: number;
    size: number;
    // ZIP compression method: 0 stored, 8 deflate (raw, no zlib header).
    method: 0 | 8;
    // CRC-32 of the uncompressed data, to check once extracted.
    crc32: number;
}

// The ZIP the `files` positions were read from: a ZIP of another size or date has been
// re-published since, and its positions can no longer be trusted.
export interface StartingPackZipInfo {
    size: number;
    // Unix seconds, same value as index.json's `mtime`.
    mtime: number;
}

export interface StartingPackManifest {
    formatVersion: 1;
    generatedAt: string;
    games: StartingPackGameEntry[];
    // Deduplicated dependency romNames bundled under roms/ - every game's requiredRoms (or
    // biosName in an older pack) - one physical file even when several games share one.
    biosRoms: string[];
    // Deduplicated sampleSet names bundled under samples/ - absent from packs built before.
    sampleSets?: string[];
    // Only in the companion <pack>.manifest.json the repository serves next to the ZIP, added
    // there by generate-repo-manifests.py - never in the ZIP's own manifest.json, which cannot
    // know where the ZIP's entries end up. Absent from a companion generated before, or when the
    // ZIP holds an entry that cannot be read this way.
    zip?: StartingPackZipInfo;
    files?: StartingPackFileEntry[];
}
