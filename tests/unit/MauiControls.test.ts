import {describe, it, expect} from 'vitest';
import {MAUI_KEYS, MAUI_CONTROL_CONTEXTS, LONG_PRESS_MS, HOLD_MS} from '@/class/MauiControls';

describe('MAUI_CONTROL_CONTEXTS', () => {
    it('only lists keys that are in MAUI_KEYS', () => {
        const known = new Set<string>(Object.values(MAUI_KEYS));
        for (const control of MAUI_CONTROL_CONTEXTS.flatMap(context => context.controls)) {
            expect(known.has(control.key)).toBe(true);
        }
    });

    it('marks the long presses with their duration from LONG_PRESS_MS and HOLD_MS', () => {
        const longPresses = MAUI_CONTROL_CONTEXTS.flatMap(context => context.controls)
            .filter(control => control.longPressMs !== undefined)
            .map(control => [control.key, control.longPressMs]);
        expect(longPresses).toEqual([
            // Held: letter jumps in "All games" and "Hiscores only", fast scroll elsewhere.
            [MAUI_KEYS.up, HOLD_MS.delay],
            [MAUI_KEYS.down, HOLD_MS.delay],
            [MAUI_KEYS.space, LONG_PRESS_MS.quit],
            [MAUI_KEYS.p, LONG_PRESS_MS.newPlayer],
            // Held together with the new-player key.
            [MAUI_KEYS.space, LONG_PRESS_MS.backOffice],
        ]);
    });
});
