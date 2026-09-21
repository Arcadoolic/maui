/**
 * The controls MAUI itself understands (as opposed to MAME's own inputs, see the BO's Manettes
 * tab): a handful of keyboard codes that Gamepads.class.ts also produces from a controller's
 * buttons/axes via src/assets/controllers.json. Single source of truth for both the screens
 * (Home.vue, userRegistration.vue switch on MAUI_KEYS, Home.vue's long presses use LONG_PRESS_MS)
 * and the BO's MAUI tab, which lists them with their role - so the tab can't drift from what the
 * screens actually do.
 */

/** KeyboardEvent.code values, and the same strings controllers.json maps gamepad inputs to. */
export const MAUI_KEYS = {
    up: 'ArrowUp',
    down: 'ArrowDown',
    left: 'ArrowLeft',
    right: 'ArrowRight',
    enter: 'Enter',
    space: 'Space',
    p: 'KeyP',
} as const;

export const LONG_PRESS_MS = {
    // Home.vue: holding the scores key this long quits MAUI altogether.
    quit: 3000,
    // Home.vue: holding the new-player key this long opens the trigram entry screen.
    newPlayer: 2000,
} as const;

export interface MauiControl {
    key: string;
    role: string;
    // Only for controls that need the key held down rather than tapped.
    longPressMs?: number;
}

export interface MauiControlContext {
    id: string;
    title: string;
    controls: MauiControl[];
}

export const MAUI_CONTROL_CONTEXTS: MauiControlContext[] = [
    {
        id: 'home',
        title: 'Game list',
        controls: [
            {key: MAUI_KEYS.up, role: 'Previous game (wraps to the last one after the first)'},
            {key: MAUI_KEYS.down, role: 'Next game (wraps to the first one after the last)'},
            {key: MAUI_KEYS.left, role: 'Previous category (if categories exist)'},
            {key: MAUI_KEYS.right, role: 'Next category (if categories exist)'},
            {key: MAUI_KEYS.enter, role: 'Confirm: launch the selected game'},
            {key: MAUI_KEYS.space, role: 'Show / hide the game scores'},
            {key: MAUI_KEYS.space, longPressMs: LONG_PRESS_MS.quit, role: 'Quitter MAUI'},
            {key: MAUI_KEYS.p, longPressMs: LONG_PRESS_MS.newPlayer, role: 'Create a new player (3-letter tag)'},
        ],
    },
    {
        id: 'registration',
        title: 'Player creation (3-letter tag)',
        controls: [
            {key: MAUI_KEYS.up, role: 'Previous letter (Z after A)'},
            {key: MAUI_KEYS.down, role: 'Next letter (A after Z)'},
            {key: MAUI_KEYS.left, role: 'Previous tag letter'},
            {key: MAUI_KEYS.right, role: 'Next tag letter'},
            {key: MAUI_KEYS.p, role: 'Confirm the tag (after at least one input press)'},
            {key: MAUI_KEYS.space, role: 'Cancel'},
        ],
    },
    {
        id: 'vote',
        title: 'Vote after a game (thumbs up / neutral / thumbs down)',
        controls: [
            {key: MAUI_KEYS.left, role: 'Move towards thumbs down'},
            {key: MAUI_KEYS.right, role: 'Move towards thumbs up'},
            {key: MAUI_KEYS.enter, role: 'Confirm the selected vote (neutral by default)'},
            {key: MAUI_KEYS.space, role: 'Decide later (stays neutral, asked again next time)'},
        ],
    },
];

const KEY_LABELS: Record<string, string> = {
    [MAUI_KEYS.up]: '↑',
    [MAUI_KEYS.down]: '↓',
    [MAUI_KEYS.left]: '←',
    [MAUI_KEYS.right]: '→',
    [MAUI_KEYS.enter]: 'Enter',
    [MAUI_KEYS.space]: 'Space',
    [MAUI_KEYS.p]: 'P',
};

export function keyLabel(key: string): string {
    return KEY_LABELS[key] ?? key;
}

/** Button names of the W3C "standard" Gamepad layout, the one controllers.json's "standard" entry follows. */
export const STANDARD_BUTTON_NAMES: Record<number, string> = {
    0: 'A', 1: 'B', 2: 'X', 3: 'Y', 4: 'LB', 5: 'RB', 6: 'LT', 7: 'RT',
    8: 'Back', 9: 'Start', 10: 'L3', 11: 'R3',
    12: 'd-pad up', 13: 'd-pad down', 14: 'd-pad left', 15: 'd-pad right', 16: 'Guide',
};

/**
 * Every physical input of `mapping` (a controllers.json entry) that produces `key`, e.g.
 * ["Button 0 (A)", "Axis 1 −"]. Axis entries are keyed by direction, as in Gamepads.class.ts:
 * "0" is the negative half of the axis, "1" the positive half. Buttons are numbered from 0, like
 * the Gamepad API (and unlike MAME's JOYCODE_x_BUTTONn, which counts from 1).
 */
export function describeGamepadInputs(
    mapping: ControllerMapping, key: string, buttonNames: Record<number, string> = {},
): string[] {
    const inputs: string[] = [];
    for (const [index, mappedKey] of Object.entries(mapping.buttons)) {
        if (mappedKey === key) {
            const name = buttonNames[Number(index)];
            inputs.push(name ? `Button ${index} (${name})` : `Button ${index}`);
        }
    }
    for (const [index, directions] of Object.entries(mapping.axes)) {
        for (const [direction, mappedKey] of Object.entries(directions)) {
            if (mappedKey === key) {
                inputs.push(`Axis ${index} ${direction === '0' ? '−' : '+'}`);
            }
        }
    }
    return inputs;
}
