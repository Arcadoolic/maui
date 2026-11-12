/**
 * The controls MAUI itself understands (as opposed to MAME's own inputs, see the BO's MAME >
 * Controls tab): a handful of keys, which the keyboard keys, mouse buttons and gamepad inputs set
 * in the BO's MAUI > Controls tab produce (MauiControlBindings.ts, MauiControlsRuntime.ts). Single
 * source of truth for both the screens (Home.vue, userRegistration.vue switch on MAUI_KEYS,
 * the default actions of Hotkeys.ts use LONG_PRESS_MS) and that tab, which lists them with their role - so
 * the tab can't drift from what the screens actually do.
 */

/**
 * MAUI's keys, named after the KeyboardEvent.code that produces each by default, and the strings
 * controllers.json and maui-controls.json map inputs to.
 */
export const MAUI_KEYS = {
    up: 'ArrowUp',
    down: 'ArrowDown',
    left: 'ArrowLeft',
    right: 'ArrowRight',
    enter: 'Enter',
    space: 'Space',
    p: 'KeyP',
} as const;

// The holds of the default triggers (Hotkeys.ts defaultActions()).
export const LONG_PRESS_MS = {
    // Holding the new-player key this long opens the trigram entry screen, what Home.vue always did.
    newPlayer: 2000,
    // Quitting MAUI (Escape) and shutting the cabinet down (O) never come from a key hit by mistake.
    quit: 3000,
    shutdown: 3000,
} as const;

/** Home.vue: holding up or down in the game list (see startHold()). */
export const HOLD_MS = {
    // How long the key is held before the list starts moving by itself.
    delay: 500,
    // "All games" and "Hiscores only": time on each letter, enough to read it before the next jump.
    alphaJump: 450,
    // Any other category: time on each game.
    fastScroll: 150,
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
            {key: MAUI_KEYS.up, longPressMs: HOLD_MS.delay, role: 'Held: jump to the previous letter in "All games" and "Hiscores only", scroll fast in the other categories'},
            {key: MAUI_KEYS.down, longPressMs: HOLD_MS.delay, role: 'Held: jump to the next letter in "All games" and "Hiscores only", scroll fast in the other categories'},
            {key: MAUI_KEYS.left, role: 'Previous category (if categories exist)'},
            {key: MAUI_KEYS.right, role: 'Next category (if categories exist)'},
            {key: MAUI_KEYS.enter, role: 'Confirm: launch the selected game (as its trigger below says)'},
            {key: MAUI_KEYS.space, role: 'Show / hide the game scores (as its trigger below says; on release when another action holds the key)'},
            {key: MAUI_KEYS.p, role: 'Create a new player (as its trigger below says)'},
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

/** Button names of the W3C "standard" Gamepad layout, the one controllers.json's "standard" entry follows. */
export const STANDARD_BUTTON_NAMES: Record<number, string> = {
    0: 'A', 1: 'B', 2: 'X', 3: 'Y', 4: 'LB', 5: 'RB', 6: 'LT', 7: 'RT',
    8: 'Back', 9: 'Start', 10: 'L3', 11: 'R3',
    12: 'd-pad up', 13: 'd-pad down', 14: 'd-pad left', 15: 'd-pad right', 16: 'Guide',
};
