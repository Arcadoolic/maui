import type {StartingPackManifest} from '@/types/StartingPackManifest';

// The games a weak cabinet is not offered: a pack's companion manifest gives the speed of its
// games on a Raspberry Pi 3 (`pi3Speeds`, measured once with `mame -bench` by maui-repository),
// and a machine of that class only takes the ones with room to spare. Electron-free.

// Under this (percent of the real speed, measured without video nor sound output) a game is
// left out: 100 is not enough once the screen and the sound are really driven.
export const MIN_PI3_SPEED = 120;

// At or under this much memory the machine is taken for a Raspberry Pi 3 or the like - the same
// limit that turns the front's Lite mode on by itself (UiMode.ts).
const WEAK_MEMORY_BYTES = 2 * 1024 ** 3;

export function isWeakHardware(totalMemBytes: number): boolean {
    return totalMemBytes <= WEAK_MEMORY_BYTES;
}

/**
 * The rom names of a form's `forceSlow` fields: the too slow games the BO's user asked for all the
 * same (the cross of the pack picker). One field gives a string, several an array; anything that
 * is not a rom name is dropped.
 */
export function parseForcedGames(value: unknown): Set<string> {
    const values = Array.isArray(value) ? value : [value];
    return new Set(values.filter((name): name is string => typeof name === 'string' && /^[a-z0-9_]{1,32}$/.test(name)));
}

/**
 * The games of `manifest` too slow for a weak cabinet, each with the reason. A game that was not
 * measured (or a manifest without speeds, from a repository not updated yet) is kept, and so are
 * the `forced` ones: the measure is taken without picture nor sound and its limit is a guess, the
 * cabinet's owner may know better.
 */
export function findTooSlowGames(
    manifest: Pick<StartingPackManifest, 'games' | 'pi3Speeds'>, forced: ReadonlySet<string> = new Set(),
): Map<string, string> {
    const tooSlow = new Map<string, string>();
    const speeds = manifest.pi3Speeds;
    if (!speeds || typeof speeds !== 'object') {
        return tooSlow;
    }
    for (const {romName} of manifest.games ?? []) {
        const speed = Object.hasOwn(speeds, romName) ? speeds[romName] : undefined;
        if (typeof speed === 'number' && Number.isFinite(speed) && speed < MIN_PI3_SPEED && !forced.has(romName)) {
            tooSlow.set(romName, `${Math.floor(speed)}% of its speed on a Raspberry Pi 3`);
        }
    }
    return tooSlow;
}
