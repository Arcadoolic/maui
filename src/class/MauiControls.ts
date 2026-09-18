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
        title: 'Liste des jeux',
        controls: [
            {key: MAUI_KEYS.up, role: 'Jeu précédent (revient au dernier après le premier)'},
            {key: MAUI_KEYS.down, role: 'Jeu suivant (revient au premier après le dernier)'},
            {key: MAUI_KEYS.left, role: 'Catégorie précédente (si des catégories existent)'},
            {key: MAUI_KEYS.right, role: 'Catégorie suivante (si des catégories existent)'},
            {key: MAUI_KEYS.enter, role: 'Valider : lancer le jeu sélectionné'},
            {key: MAUI_KEYS.space, role: 'Afficher / masquer les scores du jeu'},
            {key: MAUI_KEYS.space, longPressMs: LONG_PRESS_MS.quit, role: 'Quitter MAUI'},
            {key: MAUI_KEYS.p, longPressMs: LONG_PRESS_MS.newPlayer, role: 'Créer un nouveau joueur (trigramme)'},
        ],
    },
    {
        id: 'registration',
        title: 'Création d\'un joueur (trigramme)',
        controls: [
            {key: MAUI_KEYS.up, role: 'Lettre précédente (Z après A)'},
            {key: MAUI_KEYS.down, role: 'Lettre suivante (A après Z)'},
            {key: MAUI_KEYS.left, role: 'Lettre du trigramme précédente'},
            {key: MAUI_KEYS.right, role: 'Lettre du trigramme suivante'},
            {key: MAUI_KEYS.p, role: 'Valider le trigramme (après au moins un appui de saisie)'},
            {key: MAUI_KEYS.space, role: 'Annuler'},
        ],
    },
];

const KEY_LABELS: Record<string, string> = {
    [MAUI_KEYS.up]: '↑',
    [MAUI_KEYS.down]: '↓',
    [MAUI_KEYS.left]: '←',
    [MAUI_KEYS.right]: '→',
    [MAUI_KEYS.enter]: 'Entrée',
    [MAUI_KEYS.space]: 'Espace',
    [MAUI_KEYS.p]: 'P',
};

export function keyLabel(key: string): string {
    return KEY_LABELS[key] ?? key;
}

/** Button names of the W3C "standard" Gamepad layout, the one controllers.json's "standard" entry follows. */
export const STANDARD_BUTTON_NAMES: Record<number, string> = {
    0: 'A', 1: 'B', 2: 'X', 3: 'Y', 4: 'LB', 5: 'RB', 6: 'LT', 7: 'RT',
    8: 'Back', 9: 'Start', 10: 'L3', 11: 'R3',
    12: 'croix haut', 13: 'croix bas', 14: 'croix gauche', 15: 'croix droite', 16: 'Guide',
};

/**
 * Every physical input of `mapping` (a controllers.json entry) that produces `key`, e.g.
 * ["Bouton 0 (A)", "Axe 1 −"]. Axis entries are keyed by direction, as in Gamepads.class.ts:
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
            inputs.push(name ? `Bouton ${index} (${name})` : `Bouton ${index}`);
        }
    }
    for (const [index, directions] of Object.entries(mapping.axes)) {
        for (const [direction, mappedKey] of Object.entries(directions)) {
            if (mappedKey === key) {
                inputs.push(`Axe ${index} ${direction === '0' ? '−' : '+'}`);
            }
        }
    }
    return inputs;
}
