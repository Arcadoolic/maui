import ControllerMappingJson from '../assets/controllers.json';
import {MAUI_KEYS, STANDARD_BUTTON_NAMES} from './MauiControls';
import {defaultHotkeys, MAUI_KEY_REF, parseHotkey, type Hotkey} from './Hotkeys';

/**
 * Which keyboard keys, mouse buttons and gamepad inputs produce each of MAUI's keys (MAUI_KEYS),
 * as set from the BO's MAUI > Controls tab and kept in maui-controls.json next to MAUI's config.
 * Without that file, MAUI behaves as it always did: the keyboard keys MAUI_KEYS names and the
 * gamepad layouts of src/assets/controllers.json. Electron-free, so it stays unit-testable; read by
 * the front (MauiControlsRuntime.ts) and written by the BO.
 *
 * Unlike MAME, an input produces one MAUI key at most: the front's screens act on one key per
 * press, and a button both launching a game and showing its scores would make no sense. Adding an
 * input to a key therefore takes it from the key it had.
 */
export interface MauiBindings {
    // KeyboardEvent.code -> MAUI key.
    keyboard: Record<string, string>;
    // MouseEvent.button (0 left, 1 middle, 2 right, 3 back, 4 forward) -> MAUI key.
    mouse: Record<string, string>;
    // Gamepad layouts, keyed like Gamepads.class.ts's mappingFor(): "standard" (every pad without a
    // layout of its own) or a pad's id. An empty string means the input does nothing.
    pads: Record<string, ControllerMapping>;
    // The front's actions triggered by a key pressed, held, or two keys together (Hotkeys.ts).
    hotkeys: Hotkey[];
}

export type MauiInput =
    | {device: 'keyboard'; code: string}
    | {device: 'mouse'; button: number}
    | {device: 'pad'; layout: string; button: number}
    | {device: 'pad'; layout: string; axis: number; direction: 0 | 1};

export const MAUI_KEY_VALUES: readonly string[] = Object.values(MAUI_KEYS);

export function defaultMauiBindings(): MauiBindings {
    return {
        keyboard: Object.fromEntries(MAUI_KEY_VALUES.map(key => [key, key])),
        mouse: {},
        pads: JSON.parse(JSON.stringify(ControllerMappingJson)) as Record<string, ControllerMapping>,
        hotkeys: defaultHotkeys(),
    };
}

/** A hotkey's key: one of MAUI's keys ("maui|Space") or a single input (a mauiInputId()). */
export function isHotkeyKey(key: string): boolean {
    return key.startsWith(MAUI_KEY_REF)
        ? MAUI_KEY_VALUES.includes(key.slice(MAUI_KEY_REF.length))
        : parseMauiInputId(key) !== undefined;
}

/** The single inputs the hotkeys name: the front must hear them even when they have no MAUI key. */
export function hotkeyInputs(bindings: MauiBindings): Set<string> {
    return new Set(bindings.hotkeys.flatMap(hotkey => hotkey.keys.filter(key => !key.startsWith(MAUI_KEY_REF))));
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Only MAUI keys (or '' for a pad input doing nothing) survive: a hand-edited file can't add others. */
function cleanMap(value: unknown, allowEmpty: boolean): Record<string, string> {
    if (!isRecord(value)) {
        return {};
    }
    return Object.fromEntries(Object.entries(value).filter(([, key]) =>
        typeof key === 'string' && (MAUI_KEY_VALUES.includes(key) || (allowEmpty && key === ''))) as [string, string][]);
}

/** maui-controls.json's content, the defaults when it's missing or unreadable. */
export function parseMauiBindings(json: string | undefined): MauiBindings {
    if (!json) {
        return defaultMauiBindings();
    }
    let parsed: unknown;
    try {
        parsed = JSON.parse(json);
    } catch {
        return defaultMauiBindings();
    }
    if (!isRecord(parsed)) {
        return defaultMauiBindings();
    }
    const pads: Record<string, ControllerMapping> = {};
    if (isRecord(parsed.pads)) {
        for (const [layout, mapping] of Object.entries(parsed.pads)) {
            if (!isRecord(mapping)) {
                continue;
            }
            const axes: ControllerMapping['axes'] = {};
            if (isRecord(mapping.axes)) {
                for (const [axis, directions] of Object.entries(mapping.axes)) {
                    axes[Number(axis)] = cleanMap(directions, true);
                }
            }
            pads[layout] = {buttons: cleanMap(mapping.buttons, true), axes};
        }
    }
    // A layout file without the standard layout would leave every other pad doing nothing.
    pads.standard ??= defaultMauiBindings().pads.standard;
    // A file from before the hotkeys keeps the ones MAUI always had; an empty list is a choice.
    const hotkeys = Array.isArray(parsed.hotkeys)
        ? parsed.hotkeys.map(hotkey => parseHotkey(hotkey, isHotkeyKey)).filter((hotkey): hotkey is Hotkey => hotkey !== null)
        : defaultHotkeys();
    return {keyboard: cleanMap(parsed.keyboard, false), mouse: cleanMap(parsed.mouse, false), pads, hotkeys};
}

export function serializeMauiBindings(bindings: MauiBindings): string {
    return `${JSON.stringify({version: 1, ...bindings}, null, 4)}\n`;
}

/** The MAUI key `input` produces, '' for none. */
export function keyOfInput(bindings: MauiBindings, input: MauiInput): string {
    switch (input.device) {
        case 'keyboard':
            return bindings.keyboard[input.code] ?? '';
        case 'mouse':
            return bindings.mouse[String(input.button)] ?? '';
        default: {
            const mapping = bindings.pads[input.layout];
            if ('axis' in input) {
                return mapping?.axes[input.axis]?.[input.direction] ?? '';
            }
            return mapping?.buttons[input.button] ?? '';
        }
    }
}

/** Every input producing `key`: keyboard, mouse, then the gamepad layouts (standard first). */
export function inputsOfKey(bindings: MauiBindings, key: string): MauiInput[] {
    const inputs: MauiInput[] = [];
    for (const [code, mapped] of Object.entries(bindings.keyboard)) {
        if (mapped === key) {
            inputs.push({device: 'keyboard', code});
        }
    }
    for (const [button, mapped] of Object.entries(bindings.mouse)) {
        if (mapped === key) {
            inputs.push({device: 'mouse', button: Number(button)});
        }
    }
    const layouts = Object.keys(bindings.pads).sort((a, b) => Number(b === 'standard') - Number(a === 'standard'));
    for (const layout of layouts) {
        const mapping = bindings.pads[layout];
        for (const [button, mapped] of Object.entries(mapping.buttons)) {
            if (mapped === key) {
                inputs.push({device: 'pad', layout, button: Number(button)});
            }
        }
        for (const [axis, directions] of Object.entries(mapping.axes)) {
            for (const direction of [0, 1] as const) {
                if (directions[direction] === key) {
                    inputs.push({device: 'pad', layout, axis: Number(axis), direction});
                }
            }
        }
    }
    return inputs;
}

function withKey(bindings: MauiBindings, input: MauiInput, key: string): MauiBindings {
    const next: MauiBindings = JSON.parse(JSON.stringify(bindings));
    switch (input.device) {
        case 'keyboard':
            if (key) {
                next.keyboard[input.code] = key;
            } else {
                delete next.keyboard[input.code];
            }
            break;
        case 'mouse':
            if (key) {
                next.mouse[String(input.button)] = key;
            } else {
                delete next.mouse[String(input.button)];
            }
            break;
        default: {
            const mapping = next.pads[input.layout] ??= {buttons: {}, axes: {}};
            if ('axis' in input) {
                (mapping.axes[input.axis] ??= {})[input.direction] = key;
            } else {
                mapping.buttons[input.button] = key;
            }
        }
    }
    return next;
}

/** `input` now produces `key`. `takenFrom`: the MAUI key it produced before, if another one. */
export function addInput(bindings: MauiBindings, key: string, input: MauiInput): {bindings: MauiBindings; takenFrom?: string} {
    const before = keyOfInput(bindings, input);
    return {bindings: withKey(bindings, input, key), ...(before && before !== key ? {takenFrom: before} : {})};
}

/** `input` no longer produces anything. */
export function removeInput(bindings: MauiBindings, input: MauiInput): MauiBindings {
    return withKey(bindings, input, '');
}

/**
 * `key` gets its default inputs back, and only them: the inputs added to it lose it, and its
 * default inputs given meanwhile to another key come back to it.
 */
export function resetKey(bindings: MauiBindings, key: string): MauiBindings {
    let next = bindings;
    for (const input of inputsOfKey(bindings, key)) {
        next = removeInput(next, input);
    }
    for (const input of inputsOfKey(defaultMauiBindings(), key)) {
        next = withKey(next, input, key);
    }
    return next;
}

/** Whether `key` has exactly its default inputs. */
export function isDefaultKey(bindings: MauiBindings, key: string): boolean {
    const ids = (inputs: MauiInput[]) => inputs.map(mauiInputId).sort().join('\n');
    return ids(inputsOfKey(bindings, key)) === ids(inputsOfKey(defaultMauiBindings(), key));
}

/** A form value naming one input, what the BO's pills post to remove it. */
export function mauiInputId(input: MauiInput): string {
    switch (input.device) {
        case 'keyboard':
            return `key|${input.code}`;
        case 'mouse':
            return `mouse|${input.button}`;
        default:
            return 'axis' in input
                ? `axis|${input.axis}|${input.direction}|${input.layout}`
                : `button|${input.button}|${input.layout}`;
    }
}

/** The input a mauiInputId() names, undefined for anything malformed. */
export function parseMauiInputId(id: string): MauiInput | undefined {
    const [kind, ...rest] = id.split('|');
    const isIndex = (value: string | undefined) => value !== undefined && /^\d{1,2}$/.test(value);
    if (kind === 'key' && /^[A-Za-z0-9]{1,32}$/.test(rest[0] ?? '') && rest.length === 1) {
        return {device: 'keyboard', code: rest[0]};
    }
    if (kind === 'mouse' && rest.length === 1 && /^[0-4]$/.test(rest[0])) {
        return {device: 'mouse', button: Number(rest[0])};
    }
    if (kind === 'button' && isIndex(rest[0]) && rest.length >= 2) {
        return {device: 'pad', button: Number(rest[0]), layout: rest.slice(1).join('|')};
    }
    if (kind === 'axis' && isIndex(rest[0]) && (rest[1] === '0' || rest[1] === '1') && rest.length >= 3) {
        return {device: 'pad', axis: Number(rest[0]), direction: rest[1] === '1' ? 1 : 0, layout: rest.slice(2).join('|')};
    }
    return undefined;
}

const KEY_NAMES: Record<string, string> = {
    ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', Enter: 'Enter', Space: 'Space', Escape: 'Escape',
    Backspace: 'Backspace', Tab: 'Tab', ShiftLeft: 'Left Shift', ShiftRight: 'Right Shift',
    ControlLeft: 'Left Ctrl', ControlRight: 'Right Ctrl', AltLeft: 'Left Alt', AltRight: 'Right Alt',
    NumpadEnter: 'Keypad Enter',
};

const MOUSE_NAMES = ['Left button', 'Middle button', 'Right button', 'Back button', 'Forward button'];

/** What a BO pill shows for `input`. Keys are named after their place on a US keyboard, like MAME. */
export function describeMauiInput(input: MauiInput): string {
    switch (input.device) {
        case 'keyboard': {
            const letterOrDigit = /^(?:Key([A-Z])|Digit(\d))$/.exec(input.code);
            if (letterOrDigit) {
                return letterOrDigit[1] ?? letterOrDigit[2];
            }
            return KEY_NAMES[input.code] ?? input.code.replace(/^Numpad/, 'Keypad ');
        }
        case 'mouse':
            return MOUSE_NAMES[input.button] ?? `Button ${input.button}`;
        default: {
            const standard = input.layout === 'standard';
            if ('axis' in input) {
            // Axes 0/1 are the left stick (or the d-pad of an arcade encoder) on most pads.
                const named = input.axis === 0 ? (input.direction ? 'Stick right' : 'Stick left')
                    : input.axis === 1 ? (input.direction ? 'Stick down' : 'Stick up') : '';
                return named ? `${named} (axis ${input.axis} ${input.direction ? '+' : '−'})`
                    : `Axis ${input.axis} ${input.direction ? '+' : '−'}`;
            }
            const name = standard ? STANDARD_BUTTON_NAMES[input.button] : undefined;
            return name ? `Button ${input.button} (${name})` : `Button ${input.button}`;
        }
    }
}
