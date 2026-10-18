import {existsSync, readFileSync} from 'fs';
import {dirname, join} from 'path';
import {ipcRenderer} from 'electron';
import Config from './Config.class';
import Gamepads from './Gamepads.class';
import {parseMauiBindings, type MauiBindings} from './MauiControlBindings';
import {
    CANCEL_CAPTURE_CHANNEL, CAPTURE_PAD_CHANNEL, CONTROLS_CHANGED_CHANNEL, PAD_CAPTURED_CHANNEL, type PadCaptureReply,
} from './FrontControlsBridge';

/**
 * The front's side of the BO's MAUI > Controls tab: reads maui-controls.json (MauiControlBindings.ts)
 * into what turns a keyboard key, a mouse button or a gamepad input into one of MAUI's keys, again
 * whenever the BO says it changed, and catches a gamepad input for the BO to bind.
 */

let bindings: MauiBindings = parseMauiBindings(undefined);

export function getMauiControlsPath(): string {
    return join(dirname(new Config().configPath), 'maui-controls.json');
}

function load(): void {
    const path = getMauiControlsPath();
    bindings = parseMauiBindings(existsSync(path) ? readFileSync(path, 'utf8') : undefined);
    Gamepads.controllerMapping = bindings.pads;
}

/**
 * The MAUI key (MAUI_KEYS) a useControllable() event stands for, '' for none: a gamepad's (or a
 * mouse button's) carries it already, a keyboard's is looked up.
 */
export function controlKey(e: Event, isGamepad: boolean): string {
    return isGamepad ? (e as CustomEvent).detail.key : bindings.keyboard[(e as KeyboardEvent).code] ?? '';
}

// A mouse button bound to a MAUI key goes the gamepads' way: a gamepadKeydown/gamepadKeyup event.
// Not over the windowed front's list of games or categories, which take the mouse themselves
// (Games.vue, Categories.vue): a click there would also act as the bound key.
function onMouse(e: MouseEvent, eventName: 'gamepadKeydown' | 'gamepadKeyup'): void {
    if (e.target instanceof Element && e.target.closest('[data-mouse-nav].mouse')) {
        return;
    }
    const key = bindings.mouse[String(e.button)];
    if (key) {
        window.dispatchEvent(new CustomEvent(eventName, {detail: {key, value: eventName === 'gamepadKeydown' ? 1 : 0}}));
    }
}

async function onCapturePad(_event: unknown, nonce: string): Promise<void> {
    const reply: PadCaptureReply = {nonce};
    if (Gamepads.isSuspended()) {
        reply.error = 'A game is running on the cabinet: quit it first.';
    } else {
        const caught = await Gamepads.captureNext(30000);
        if (caught === 'cancelled') {
            reply.cancelled = true;
        } else if (!caught) {
            reply.error = 'No gamepad input within the allotted time (30s) - try again (is the gamepad connected?).'
                // Windows.Gaming.Input only hands an Xbox-type pad's presses to the focused window.
                + (process.platform === 'win32' ? ' On Windows, click MAUI\'s window before pressing the button.' : '');
        } else {
            const own = caught.pad.mapping || caught.pad.id;
            reply.capture = {
                layout: bindings.pads[own] ? own : 'standard',
                padName: caught.pad.id,
                ...(caught.axis !== undefined ? {axis: caught.axis, direction: caught.direction} : {button: caught.button}),
            };
        }
    }
    ipcRenderer.send(PAD_CAPTURED_CHANNEL, reply);
}

let started = false;

/** Once, from App.vue: reads the bindings and starts listening to the mouse and the BO. */
export function startMauiControls(): void {
    if (started) {
        return;
    }
    started = true;
    load();
    window.addEventListener('mousedown', e => onMouse(e, 'gamepadKeydown'));
    window.addEventListener('mouseup', e => onMouse(e, 'gamepadKeyup'));
    // No menu when the right button is one of MAUI's keys.
    window.addEventListener('contextmenu', (e) => {
        if (bindings.mouse['2']) {
            e.preventDefault();
        }
    });
    ipcRenderer.on(CONTROLS_CHANGED_CHANNEL, load);
    ipcRenderer.on(CAPTURE_PAD_CHANNEL, (event, nonce: string) => void onCapturePad(event, nonce));
    ipcRenderer.on(CANCEL_CAPTURE_CHANNEL, () => Gamepads.cancelCapture());
}
