// The file the BO's per-game controls card exports one game's own controls to (the `<newseq>`
// overrides of cfg/<rom>.cfg), and imports them from: for the same game on another cabinet with the
// same controllers. JSON. Electron-free, unit-tested.

import {GAME_SEQ_TYPES, isRemappablePortType, type GameCfgOverride, type GameSeqType} from '@/class/MameCfg';
import {isImportableSeq} from '@/class/MameControlsFile';

export const GAME_CONTROLS_FILE_FORMAT = 'maui-mame-game-controls';
const GAME_CONTROLS_FILE_VERSION = 1;
// A game has a few dozen commands, three sequences at most each.
const MAX_GAME_CONTROLS = 1000;
export const MAX_GAME_CONTROLS_FILE_BYTES = 256 * 1024;

// What MAME names a rom, and a device tag (":IN0", ":maincpu:p1").
const ROM_NAME = /^[a-z0-9_]{1,32}$/;
const DEVICE_TAG = /^[A-Za-z0-9_:.-]{1,128}$/;

/** The export file's content. `mameVersion` is only there for whoever reads it. */
export function buildGameControlsFile(
    romName: string, overrides: GameCfgOverride[], mameVersion: string, exportedAt: Date,
): string {
    return JSON.stringify({
        format: GAME_CONTROLS_FILE_FORMAT,
        version: GAME_CONTROLS_FILE_VERSION,
        exportedAt: exportedAt.toISOString(),
        mameVersion,
        romName,
        controls: overrides,
    }, null, 2) + '\n';
}

/**
 * The overrides of an export file for `romName`, from an untrusted upload, their sequences checked
 * against the keyboard keys this MAME knows (`codes`, see isImportableSeq()). Throws an Error whose
 * message the BO shows when the file is not one, is for another game, or holds something this MAME
 * cannot take.
 */
export function parseGameControlsFile(text: string, romName: string, codes: Map<string, string>): GameCfgOverride[] {
    let content: unknown;
    try {
        content = JSON.parse(text);
    } catch {
        throw new Error('This file is not JSON.');
    }
    const file = content as {format?: unknown; romName?: unknown; controls?: unknown};
    if (!file || typeof file !== 'object' || file.format !== GAME_CONTROLS_FILE_FORMAT || !Array.isArray(file.controls)) {
        throw new Error('This file is not a game controls export.');
    }
    if (typeof file.romName !== 'string' || !ROM_NAME.test(file.romName)) {
        throw new Error('This file names no valid game.');
    }
    if (file.romName !== romName) {
        throw new Error(`This file holds the controls of "${file.romName}", not of "${romName}".`);
    }
    if (file.controls.length > MAX_GAME_CONTROLS) {
        throw new Error('This file holds too many controls.');
    }
    const seen = new Set<string>();
    return file.controls.map((entry: unknown) => {
        const {portType, tag, mask, defvalue, seqType, seq} = (entry ?? {}) as Record<string, unknown>;
        if (typeof portType !== 'string' || !isRemappablePortType(portType)
            || typeof tag !== 'string' || !DEVICE_TAG.test(tag)
            || !Number.isInteger(mask) || (mask as number) < 0 || !Number.isInteger(defvalue) || (defvalue as number) < 0
            || !GAME_SEQ_TYPES.includes(seqType as GameSeqType)) {
            throw new Error('This file holds an invalid command.');
        }
        if (typeof seq !== 'string' || !isImportableSeq(seq, codes)) {
            throw new Error(`The "${portType}" command holds a key or button this MAME does not know.`);
        }
        const key = `${portType}|${tag}|${mask}|${defvalue}|${seqType}`;
        if (seen.has(key)) {
            throw new Error(`The "${portType}" command is in this file twice.`);
        }
        seen.add(key);
        return {
            portType, tag, mask: mask as number, defvalue: defvalue as number,
            seqType: seqType as GameSeqType, seq: seq.trim().split(/\s+/).join(' '),
        };
    });
}
