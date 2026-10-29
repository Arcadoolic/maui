// The file the BO's Controls tab exports MAME's global controls to (default.cfg's <input> block)
// with the gamepads pinned to a JOY number (the controller file's <mapdevice>, MameCtrlr.ts), and
// imports them from: on another cabinet with the same controllers, or the same one after a
// reinstall. JSON. Electron-free, unit-tested.

import {inputCodeKind, type InputDefaults} from '@/class/MameInputSeq';

export const MAME_CONTROLS_FILE_FORMAT = 'maui-mame-controls';
const MAME_CONTROLS_FILE_VERSION = 1;
// default.cfg holds a few dozen ports: well beyond, the file is not one of ours.
const MAX_CONTROLS = 2000;
const MAX_PINNED_DEVICES = 64;
export const MAX_MAME_CONTROLS_FILE_BYTES = 256 * 1024;

const JOYCODE = /^JOYCODE_\d+$/;
// MAME's own spelling of a joystick, mouse or light gun code, e.g. "JOYCODE_1_HAT1UP".
const DEVICE_CODE = /^(?:JOYCODE|MOUSECODE|GUNCODE)_\d+_[A-Z0-9_]+$/;

export interface MameControls {
    // default.cfg's standard sequence per port type, e.g. "P1_BUTTON1" -> "JOYCODE_1_BUTTON1".
    controls: Map<string, string>;
    // The device id pinned to each JOY number, e.g. "JOYCODE_1" -> MAME's id for the pad.
    pinnedDevices: Map<string, string>;
}

/** The export file's content. `mameVersion` is only there for whoever reads it. */
export function buildMameControlsFile(content: MameControls, mameVersion: string, exportedAt: Date): string {
    return JSON.stringify({
        format: MAME_CONTROLS_FILE_FORMAT,
        version: MAME_CONTROLS_FILE_VERSION,
        exportedAt: exportedAt.toISOString(),
        mameVersion,
        controls: Object.fromEntries(content.controls),
        pinnedDevices: Array.from(content.pinnedDevices, ([controller, device]) => ({controller, device})),
    }, null, 2) + '\n';
}

/**
 * Whether `seq` is safe to write in default.cfg: alternatives joined by `OR`, each a list of codes
 * optionally preceded by `NOT`, or `NONE` alone. A keyboard key must be one MAME listed (`codes`):
 * MAME drops its whole <input> block on the next boot when a single code is unknown. A joystick,
 * mouse or gun code depends on the devices plugged in, only its spelling is checked.
 */
export function isImportableSeq(seq: string, codes: Map<string, string>): boolean {
    const tokens = seq.trim().split(/\s+/);
    if (tokens.length === 1 && tokens[0] === 'NONE') {
        return true;
    }
    let expectsCode = true;
    let afterNot = false;
    for (const token of tokens) {
        if (token === 'OR') {
            if (expectsCode) {
                return false;
            }
            expectsCode = true;
            continue;
        }
        if (token === 'NOT') {
            if (afterNot) {
                return false;
            }
            afterNot = true;
            continue;
        }
        const known = inputCodeKind(token) === 'keyboard' ? codes.has(token) : DEVICE_CODE.test(token);
        if (!known) {
            return false;
        }
        expectsCode = false;
        afterNot = false;
    }
    return !expectsCode && !afterNot;
}

/**
 * The controls of an export file, from an untrusted upload, checked against what this MAME knows
 * (`defaults`: its port types and keyboard keys). Throws an Error whose message the BO shows when
 * the file is not one, or holds something this MAME cannot take.
 */
export function parseMameControlsFile(text: string, defaults: InputDefaults): MameControls {
    let content: unknown;
    try {
        content = JSON.parse(text);
    } catch {
        throw new Error('This file is not JSON.');
    }
    const file = content as {format?: unknown; controls?: unknown; pinnedDevices?: unknown};
    if (!file || typeof file !== 'object' || file.format !== MAME_CONTROLS_FILE_FORMAT
        || !file.controls || typeof file.controls !== 'object' || Array.isArray(file.controls)
        || !Array.isArray(file.pinnedDevices)) {
        throw new Error('This file is not a MAME controls export.');
    }
    const entries = Object.entries(file.controls as Record<string, unknown>);
    if (entries.length > MAX_CONTROLS || file.pinnedDevices.length > MAX_PINNED_DEVICES) {
        throw new Error('This file holds too many controls.');
    }

    const controls = new Map<string, string>();
    for (const [portType, seq] of entries) {
        if (!defaults.seqs.has(portType)) {
            throw new Error(`This MAME has no "${portType}" control.`);
        }
        if (typeof seq !== 'string' || !isImportableSeq(seq, defaults.codes)) {
            throw new Error(`The "${portType}" control holds a key or button this MAME does not know.`);
        }
        controls.set(portType, seq.trim().split(/\s+/).join(' '));
    }

    const pinnedDevices = new Map<string, string>();
    for (const pin of file.pinnedDevices as unknown[]) {
        const {controller, device} = (pin ?? {}) as {controller?: unknown; device?: unknown};
        if (typeof controller !== 'string' || !JOYCODE.test(controller)
            || typeof device !== 'string' || !device.trim() || /[\r\n]/.test(device)) {
            throw new Error('This file holds an invalid pinned gamepad.');
        }
        if (pinnedDevices.has(controller) || Array.from(pinnedDevices.values()).includes(device)) {
            throw new Error('This file pins a gamepad or a JOY number twice.');
        }
        pinnedDevices.set(controller, device);
    }
    return {controls, pinnedDevices};
}
