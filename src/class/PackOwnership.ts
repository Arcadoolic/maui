import type {StartingPackGameEntry, StartingPackManifest} from '@/types/StartingPackManifest';

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
    // Space its files take once extracted (rom zip + marquee/flyer/logo), see listPackGames().
    size: number;
    // The BIOS/parent set it needs (also shipped by the pack), if any.
    biosName: string | null;
    // installed: its rom zip is already here; new: it is not; no-rom: the game ships no rom file
    // of its own (nothing to compare).
    status: 'installed' | 'new' | 'no-rom';
}

/**
 * The games of a pack, sorted by name, each flagged against the installed roms (same rule as
 * computePackOwnership()) and sized. Empty for a manifest that cannot be read.
 *
 * entrySizes: uncompressed size of each entry of the pack's ZIP (ZipCentralDirectory.ts). Without
 * it (server without range support, ZIP64...), `fallbackPackSize` is spread evenly over the
 * games: a rough figure, but better than pretending a game takes no room.
 */
export function listPackGames(
    manifest: Partial<StartingPackManifest> | null | undefined, installedRomNames: readonly string[],
    entrySizes?: ReadonlyMap<string, number> | null, fallbackPackSize = 0,
): PackGameDetail[] {
    if (!manifest || manifest.formatVersion !== 1 || !Array.isArray(manifest.games)) {
        return [];
    }
    const installed = new Set(installedRomNames.map(name => name.toLowerCase()));
    const games = manifest.games;
    const sizeOf = (game: StartingPackGameEntry): number => {
        if (!entrySizes) {
            return games.length ? Math.round(fallbackPackSize / games.length) : 0;
        }
        return [
            game.hasRomFile ? `roms/${game.romName}.zip` : null,
            game.hasMarquee ? `marquees/${game.romName}.png` : null,
            game.hasFlyer ? `flyers/${game.romName}.png` : null,
            game.hasLogo ? `logos/${game.romName}.png` : null,
        ].reduce((total, entry) => total + (entry ? entrySizes.get(entry) ?? 0 : 0), 0);
    };
    return games
        .map((game): PackGameDetail => ({
            romName: game.romName,
            fullname: game.fullname || game.romName,
            year: game.year ?? null,
            manufacturer: game.manufacturer ?? null,
            categoryName: game.categoryName ?? null,
            size: sizeOf(game),
            biosName: game.biosName ?? null,
            status: !game.hasRomFile ? 'no-rom' : installed.has(game.romName.toLowerCase()) ? 'installed' : 'new',
        }))
        .sort((a, b) => a.fullname.localeCompare(b.fullname));
}

/**
 * Size of each BIOS/parent set a pack ships (`biosRoms`), by name; empty when the entry sizes are
 * unknown. A game needs its `biosName` set on top of its own files, but games sharing one only
 * need it once: the UI counts each set once per pack.
 */
export function computeBiosSizes(
    manifest: Partial<StartingPackManifest> | null | undefined, entrySizes?: ReadonlyMap<string, number> | null,
): Record<string, number> {
    if (!manifest || manifest.formatVersion !== 1 || !entrySizes) {
        return {};
    }
    return Object.fromEntries((manifest.biosRoms ?? []).map(name => [name, entrySizes.get(`roms/${name}.zip`) ?? 0]));
}

const PACK_FILENAME_RE = /^[\w.-]+\.zip$/;
const ROM_NAME_RE = /^[\w.-]+$/;

/**
 * Groups the ticked games of the repository form (`game` = "<pack>.zip|<romName>", one value per
 * ticked box, in page order) by pack, keeping that order. The same game ticked in several packs
 * (they are ticked together) is kept for the first one only, so it is fetched once. null when a
 * value is malformed: both parts flow into a URL and a child-process argv, so only bare file /
 * rom names are accepted rather than trusting what the browser sent.
 */
export function groupSelectedGames(rawValues: unknown): Map<string, string[]> | null {
    const values: unknown[] = [rawValues].flat().filter(value => value !== undefined);
    const packs = new Map<string, string[]>();
    const taken = new Set<string>();
    for (const value of values) {
        if (typeof value !== 'string') {
            return null;
        }
        const [pack, romName, ...rest] = value.split('|');
        if (rest.length || !PACK_FILENAME_RE.test(pack) || !ROM_NAME_RE.test(romName ?? '')) {
            return null;
        }
        if (taken.has(romName)) {
            continue;
        }
        taken.add(romName);
        packs.set(pack, [...(packs.get(pack) ?? []), romName]);
    }
    return packs;
}
