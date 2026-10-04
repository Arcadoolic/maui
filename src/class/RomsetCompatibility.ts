import {execFile} from 'child_process';
import type {StartingPackManifest} from '@/types/StartingPackManifest';

const COMMAND_TIMEOUT_MS = 60_000;
const MAX_FILES_SHOWN = 3;

/** What `mame -listxml` says a machine needs: its own ROMs and where the others come from. */
export interface ListedMachine {
    // Parent or BIOS set, then the devices: their ROMs are needed too.
    romof: string | null;
    cloneof: string | null;
    deviceRefs: string[];
    // "<crc32>:<size>" by ROM name, as in a manifest's `romsets`. A ROM without a good dump has
    // no CRC, and none is asked for.
    roms: Map<string, string>;
}

const attribute = (tag: string, name: string): string | null => new RegExp(`\\s${name}="([^"]*)"`).exec(tag)?.[1] ?? null;

/** Parses the output of `mame -listxml <rom>...`: the machines asked for and their devices. */
export function parseListXml(xml: string): Map<string, ListedMachine> {
    const machines = new Map<string, ListedMachine>();
    for (const block of xml.split(/<machine\s/).slice(1)) {
        const opening = ` ${block.slice(0, block.indexOf('>'))}`;
        const name = attribute(opening, 'name');
        if (!name) {
            continue;
        }
        const roms = new Map<string, string>();
        for (const [tag] of block.matchAll(/<rom\s[^>]*>/g)) {
            const romName = attribute(tag, 'name');
            const crc = attribute(tag, 'crc');
            const size = attribute(tag, 'size');
            if (romName && crc && size && attribute(tag, 'status') !== 'nodump') {
                roms.set(romName, `${crc.toLowerCase().padStart(8, '0')}:${size}`);
            }
        }
        machines.set(name, {
            romof: attribute(opening, 'romof'),
            cloneof: attribute(opening, 'cloneof'),
            deviceRefs: [...block.matchAll(/<device_ref\s[^>]*>/g)].map(([tag]) => attribute(tag, 'name')).filter((ref): ref is string => !!ref),
            roms,
        });
    }
    return machines;
}

/**
 * `name` and every set its ROMs may come from: parents, BIOS and devices, and theirs. Asked for
 * some games only, MAME lists them and their devices but not their parent or BIOS, whose ROMs
 * it repeats in the game itself: such a set is a source all the same.
 */
function sourcesOf(name: string, machines: ReadonlyMap<string, ListedMachine>, seen = new Set<string>()): Set<string> {
    if (seen.has(name)) {
        return seen;
    }
    seen.add(name);
    const machine = machines.get(name);
    for (const next of machine ? [machine.romof, machine.cloneof, ...machine.deviceRefs] : []) {
        if (next) {
            sourcesOf(next, machines, seen);
        }
    }
    return seen;
}

/**
 * The games of a pack the installed MAME cannot run with the sets the pack ships, each with the
 * reason, from the pack's manifest alone: nothing is downloaded. `machines` is what that MAME
 * expects (parseListXml()), `manifest.romsets` what each rom zip of the pack holds. A game is out
 * when MAME does not know it, or when a ROM it expects - its own, its parent's, its BIOS's, a
 * device's - is in none of the pack's sets it may come from. MAME goes by CRC, not by file name,
 * and so does this.
 *
 * null when the manifest has no `romsets` (written before the repository described them): nothing
 * can be said. A game whose own set the repository could not read is left alone too. The sets
 * already on the cabinet are not looked at: the import overwrites them with the pack's.
 */
export function findIncompatibleGames(
    manifest: Partial<StartingPackManifest> | null | undefined, machines: ReadonlyMap<string, ListedMachine>,
): Map<string, string> | null {
    const romsets = manifest?.romsets;
    if (!manifest || !romsets || typeof romsets !== 'object' || !Array.isArray(manifest.games)) {
        return null;
    }
    const contents = new Map(Object.entries(romsets)
        .filter(([, files]) => Array.isArray(files))
        .map(([name, files]) => [name, new Set(files)]));
    const incompatible = new Map<string, string>();
    for (const game of manifest.games) {
        if (!game.hasRomFile || !contents.has(game.romName)) {
            continue;
        }
        if (!machines.has(game.romName)) {
            incompatible.set(game.romName, 'it does not know this game');
            continue;
        }
        const sources = [...sourcesOf(game.romName, machines)];
        const missing: string[] = [];
        for (const source of sources) {
            for (const [romName, key] of machines.get(source)?.roms ?? []) {
                if (!sources.some(set => contents.get(set)?.has(key))) {
                    missing.push(`${source}/${romName}`);
                }
            }
        }
        if (missing.length) {
            const more = missing.length - MAX_FILES_SHOWN;
            incompatible.set(game.romName, `the pack lacks ${missing.slice(0, MAX_FILES_SHOWN).join(', ')}${more > 0 ? ` and ${more} more` : ''}`);
        }
    }
    return incompatible;
}

/**
 * What the installed MAME expects for `romNames` (~0.05s for a few dozen games). Null when MAME
 * could not be run.
 */
export function listMachines(mameBinary: string, iniPath: string, romNames: readonly string[]): Promise<Map<string, ListedMachine> | null> {
    if (!romNames.length) {
        return Promise.resolve(new Map());
    }
    return new Promise((resolve) => {
        execFile(
            mameBinary,
            ['-listxml', ...romNames, '-inipath', iniPath, '-homepath', iniPath],
            {encoding: 'utf8', cwd: iniPath, timeout: COMMAND_TIMEOUT_MS, windowsHide: true, maxBuffer: 256 * 1024 * 1024},
            (error, stdout) => {
                // MAME exits non-zero as soon as one name is unknown, having listed the others.
                if (error && typeof error.code !== 'number') {
                    resolve(null);
                    return;
                }
                resolve(parseListXml(stdout));
            },
        );
    });
}
