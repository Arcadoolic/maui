import {describe, it, expect} from 'vitest';
import {
    MAUI_KEYS, MAUI_CONTROL_CONTEXTS, LONG_PRESS_MS, STANDARD_BUTTON_NAMES, keyLabel, describeGamepadInputs,
} from '@/class/MauiControls';
import controllers from '@/assets/controllers.json';

describe('describeGamepadInputs', () => {
    const mapping: ControllerMapping = {
        buttons: {0: 'Enter', 2: 'Enter', 6: 'KeyP'},
        axes: {0: {0: 'ArrowLeft', 1: 'ArrowRight'}, 1: {0: 'ArrowUp', 1: 'ArrowDown'}},
    };

    it('lists every button and axis half that produces the key', () => {
        expect(describeGamepadInputs(mapping, 'Enter')).toEqual(['Bouton 0', 'Bouton 2']);
        expect(describeGamepadInputs(mapping, 'ArrowLeft')).toEqual(['Axe 0 −']);
        expect(describeGamepadInputs(mapping, 'ArrowDown')).toEqual(['Axe 1 +']);
    });

    it('returns nothing for a key the mapping never produces', () => {
        expect(describeGamepadInputs(mapping, 'Space')).toEqual([]);
    });

    it('appends the button name when given', () => {
        expect(describeGamepadInputs(mapping, 'Enter', {0: 'A'})).toEqual(['Bouton 0 (A)', 'Bouton 2']);
    });

    it('reads the real "standard" entry of controllers.json', () => {
        const standard = (controllers as {standard: ControllerMapping}).standard;
        expect(describeGamepadInputs(standard, MAUI_KEYS.enter, STANDARD_BUTTON_NAMES)).toEqual(['Bouton 0 (A)']);
        expect(describeGamepadInputs(standard, MAUI_KEYS.up, STANDARD_BUTTON_NAMES))
            .toEqual(['Bouton 12 (croix haut)', 'Axe 1 −']);
    });

    it('gives every MAUI key at least one input on the "standard" layout', () => {
        // Any pad without an entry of its own falls back to it (see Gamepads.class.ts): a key
        // with no input there is unreachable from that pad.
        const standard = (controllers as {standard: ControllerMapping}).standard;
        for (const key of Object.values(MAUI_KEYS)) {
            expect(describeGamepadInputs(standard, key), key).not.toEqual([]);
        }
        expect(describeGamepadInputs(standard, MAUI_KEYS.space, STANDARD_BUTTON_NAMES)).toEqual(['Bouton 1 (B)']);
        expect(describeGamepadInputs(standard, MAUI_KEYS.p, STANDARD_BUTTON_NAMES)).toEqual(['Bouton 2 (X)']);
    });
});

describe('MAUI_CONTROL_CONTEXTS', () => {
    it('only lists keys that are in MAUI_KEYS, each with a label of its own', () => {
        const known = new Set<string>(Object.values(MAUI_KEYS));
        for (const control of MAUI_CONTROL_CONTEXTS.flatMap(context => context.controls)) {
            expect(known.has(control.key)).toBe(true);
            expect(keyLabel(control.key)).not.toBe(control.key);
        }
    });

    it('marks the long presses with their duration from LONG_PRESS_MS', () => {
        const longPresses = MAUI_CONTROL_CONTEXTS.flatMap(context => context.controls)
            .filter(control => control.longPressMs !== undefined)
            .map(control => [control.key, control.longPressMs]);
        expect(longPresses).toEqual([
            [MAUI_KEYS.space, LONG_PRESS_MS.quit],
            [MAUI_KEYS.p, LONG_PRESS_MS.newPlayer],
        ]);
    });
});
