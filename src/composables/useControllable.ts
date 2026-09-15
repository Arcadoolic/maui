import {onUnmounted} from 'vue';

export type KeyAction = (e: Event, isGamepad: boolean) => void;

/**
 * Combined keyboard + gamepad key handling, matching the gamepadKeydown/gamepadKeyup
 * CustomEvents Gamepads.class.ts dispatches. Replaces src/ControllableVue.ts: Vue 3 has no
 * idiomatic class inheritance for components (D2), so this is a composable instead -
 * `const {onKeydown, onKeyup} = useControllable()`.
 *
 * Ported bug fix (design doc D2 detail): the original ControllableVue.beforeDestroy() called
 * keydownHandler()/gamepadKeydownHandler() again to get "the" listener to remove, which returns a
 * brand-new closure every time - removeEventListener silently ignored it, so every mount/destroy
 * cycle leaked a full set of handlers still bound to the destroyed instance. This composable keeps
 * the exact bound function references from registration and removes those same references in
 * onUnmounted().
 */
export function useControllable() {
    const keyPressed: {[key: string]: boolean} = {};

    function keydownHandler(keyActions: KeyAction, isKeydown: boolean) {
        return (e: KeyboardEvent) => {
            if ((isKeydown && !keyPressed[e.key]) || (!isKeydown && keyPressed[e.key])) {
                keyPressed[e.key] = isKeydown;
                keyActions(e, false);
            }
        };
    }

    function gamepadKeydownHandler(keyActions: KeyAction, isKeydown: boolean) {
        return (e: Event) => {
            const key = (e as CustomEvent).detail.key;
            if ((isKeydown && !keyPressed[key]) || (!isKeydown && keyPressed[key])) {
                keyPressed[key] = isKeydown;
                keyActions(e, true);
            }
        };
    }

    let boundKeydownHandler: ((e: KeyboardEvent) => void) | undefined;
    let boundKeyupHandler: ((e: KeyboardEvent) => void) | undefined;
    let boundGamepadKeydownHandler: ((e: Event) => void) | undefined;
    let boundGamepadKeyupHandler: ((e: Event) => void) | undefined;

    function onKeydown(keyActions: KeyAction) {
        boundKeydownHandler = keydownHandler(keyActions, true);
        boundGamepadKeydownHandler = gamepadKeydownHandler(keyActions, true);
        window.addEventListener('keydown', boundKeydownHandler);
        window.addEventListener('gamepadKeydown', boundGamepadKeydownHandler);
    }

    function onKeyup(keyActions: KeyAction) {
        boundKeyupHandler = keydownHandler(keyActions, false);
        boundGamepadKeyupHandler = gamepadKeydownHandler(keyActions, false);
        window.addEventListener('keyup', boundKeyupHandler);
        window.addEventListener('gamepadKeyup', boundGamepadKeyupHandler);
    }

    onUnmounted(() => {
        if (boundKeydownHandler) {
            window.removeEventListener('keydown', boundKeydownHandler);
        }
        if (boundGamepadKeydownHandler) {
            window.removeEventListener('gamepadKeydown', boundGamepadKeydownHandler);
        }
        if (boundKeyupHandler) {
            window.removeEventListener('keyup', boundKeyupHandler);
        }
        if (boundGamepadKeyupHandler) {
            window.removeEventListener('gamepadKeyup', boundGamepadKeyupHandler);
        }
    });

    return {onKeydown, onKeyup};
}
