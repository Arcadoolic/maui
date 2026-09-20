import type {StartingPackManifest} from '@/types/StartingPackManifest';

/**
 * What a repository pack still has to bring, compared with the roms already installed.
 * Only games shipping a rom file of their own are compared (`hasRomFile`): a game without one
 * (netlist games like Pong) leaves no zip to look for, so it says nothing about the pack.
 */
export interface PackOwnership {
    // Games of the pack that ship a rom file.
    total: number;
    // Of those, the ones whose zip is already in the roms folder.
    owned: number;
    // Fullnames of the games still missing, in manifest order.
    missing: string[];
}

/**
 * Compares a pack's manifest with the rom zips present in the roms folder (names without the
 * `.zip`). `null` when nothing can be compared: a fallback/unknown manifest, or a pack with no
 * game shipping a rom file.
 */
export function computePackOwnership(
    manifest: Partial<StartingPackManifest> | null | undefined, installedRomNames: readonly string[],
): PackOwnership | null {
    if (!manifest || manifest.formatVersion !== 1 || !Array.isArray(manifest.games)) {
        return null;
    }
    const installed = new Set(installedRomNames.map(name => name.toLowerCase()));
    const withRom = manifest.games.filter(game => game.hasRomFile);
    if (!withRom.length) {
        return null;
    }
    const missing = withRom.filter(game => !installed.has(game.romName.toLowerCase()));
    return {
        total: withRom.length,
        owned: withRom.length - missing.length,
        missing: missing.map(game => game.fullname || game.romName),
    };
}

/** Every rom of the pack is already installed: nothing to import. */
export function isPackFullyOwned(ownership: PackOwnership | null | undefined): boolean {
    return !!ownership && ownership.missing.length === 0;
}

/** One line of a pack's expandable game list. */
export interface PackGameDetail {
    romName: string;
    fullname: string;
    year: string | null;
    manufacturer: string | null;
    categoryName: string | null;
    // installed: its rom zip is already here; new: it is not; no-rom: the game ships no rom file
    // of its own (nothing to compare).
    status: 'installed' | 'new' | 'no-rom';
}

/**
 * The games of a pack, sorted by name, each flagged against the installed roms (same rule as
 * computePackOwnership()). Empty for a manifest that cannot be read.
 */
export function listPackGames(
    manifest: Partial<StartingPackManifest> | null | undefined, installedRomNames: readonly string[],
): PackGameDetail[] {
    if (!manifest || manifest.formatVersion !== 1 || !Array.isArray(manifest.games)) {
        return [];
    }
    const installed = new Set(installedRomNames.map(name => name.toLowerCase()));
    return manifest.games
        .map((game): PackGameDetail => ({
            romName: game.romName,
            fullname: game.fullname || game.romName,
            year: game.year ?? null,
            manufacturer: game.manufacturer ?? null,
            categoryName: game.categoryName ?? null,
            status: !game.hasRomFile ? 'no-rom' : installed.has(game.romName.toLowerCase()) ? 'installed' : 'new',
        }))
        .sort((a, b) => a.fullname.localeCompare(b.fullname));
}
