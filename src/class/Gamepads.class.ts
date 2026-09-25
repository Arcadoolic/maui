import {watchFile} from 'fs';
import ControllerMappingJson from '../assets/controllers.json';
import Config from '@/class/Config.class';
import {mappingNameOf, mergeControllerMappings, type GamepadInput} from '@/class/MauiControls';

const BASE_MAPPINGS = ControllerMappingJson as unknown as Record<string, ControllerMapping>;

/** What the BO's MAUI > Controls capture gets back (see capturePress()). */
export type GamepadCaptureResult = {mappingName: string; gamepadId: string; input: GamepadInput} | {error: string};

declare global {
    interface Window {
        // Called by the main process (webContents.executeJavaScript(), see background.ts) on
        // behalf of the BO - there's no IPC/preload boundary in this app.
        mauiCapturePress?: (timeoutMs: number) => Promise<GamepadCaptureResult>;
    }
}

export default class Gamepads {
    // Threshold an axis must cross to count as "pressed", and fall back under to count as
    // "released" - the same value both ways so release is never held hostage to a stick/hat
    // resting at some non-zero value instead of a perfect 0.
    protected static readonly AXIS_DEADZONE = 0.4;
    public static gamepadsIndex: number[] = [];
    public static animationFrameRequest: number = 0;
    // controllers.json plus the BO's overrides (Config.mauiControls) - see reloadMapping().
    public static controllerMapping: {[key: string]: ControllerMapping} = BASE_MAPPINGS;
    public static gamepadKeyPressed:
    Array<{buttons: boolean[], axes: Array<{wasPressed: boolean, lastPressedKey: string|null}>}> = [];
    protected static stop: boolean = false;
    // True while the requestAnimationFrame polling loop is actually scheduled. Guards init()
    // against starting a second concurrent loop (e.g. two focus events firing close together,
    // or focus racing a not-yet-processed blur) - both loops would share the same
    // gamepadKeyPressed state and each independently dispatch gamepadKeydown/gamepadKeyup,
    // doubling (or worse) every button press.
    protected static running: boolean = false;
    protected static warnedUnmappedGamepadIds: Set<string> = new Set();
    protected static watchingConfig: boolean = false;
    // Armed by capturePress(): the next new press on any pad resolves it instead of reaching
    // MAUI's screens. `baseline` holds what each pad already had held when polled first, so an
    // input held since before the capture never counts as the press.
    protected static pendingCapture?: {
        resolve: (result: GamepadCaptureResult) => void;
        timer: ReturnType<typeof setTimeout>;
        baseline: Map<number, {buttons: boolean[]; axes: number[]}>;
    };
    // Polls for a pending capture while the regular loop is paused - it stops whenever the
    // window loses the focus (App.vue), e.g. to the BO opened in a browser on the cabinet itself.
    protected static captureLoop?: ReturnType<typeof setInterval>;

    // Bound once and reused for both addEventListener and removeEventListener - passing
    // `this.onGamepadconnected.bind(this)` at each call site (as this used to) creates a new
    // function every time, so removeEventListener never matches what was actually added and the
    // listener is never really removed.
    protected static boundOnGamepadconnected?: (e: Event) => void;
    protected static boundOnGamepaddisconnected?: (e: Event) => void;

    /**
     * Registers the gamepadconnected/gamepaddisconnected listeners (once, ever - see
     * boundOnGamepadconnected above) and (re)starts the polling loop, but only if a gamepad is
     * actually known to be connected. Called on Home.vue's created() and on every Electron
     * window focus (App.vue) - both of those need to be safe to call repeatedly without
     * stacking anything. Polling otherwise starts from onGamepadconnected() once a gamepad
     * shows up - no point running a ~60Hz requestAnimationFrame loop with nothing to poll.
     */
    public static init() {
        if (!this.watchingConfig) {
            this.watchingConfig = true;
            this.reloadMapping();
            // Polled rather than fs.watch(): also sees the file being replaced as a whole, and
            // behaves the same on Linux, macOS and Windows. Cheap - one stat() a second.
            watchFile(new Config().configPath, {interval: 1000}, () => this.reloadMapping());
            window.mauiCapturePress = (timeoutMs: number) => this.capturePress(timeoutMs);
        }
        if (!this.boundOnGamepadconnected) {
            this.boundOnGamepadconnected = this.onGamepadconnected.bind(this);
            this.boundOnGamepaddisconnected = this.onGamepaddisconnected.bind(this);
            window.addEventListener('gamepadconnected', this.boundOnGamepadconnected);
            window.addEventListener('gamepaddisconnected', this.boundOnGamepaddisconnected);
        }
        if (this.gamepadsIndex.length) {
            this.resumePolling();
        }
    }

    /** controllers.json with the BO's current overrides applied (see Config.mauiControls). */
    public static reloadMapping() {
        try {
            const config = new Config();
            config.load();
            this.controllerMapping = mergeControllerMappings(BASE_MAPPINGS, config.mauiControls);
        } catch (error) {
            // Typically the file caught mid-write: keep the previous mapping, the next change
            // notification reloads it.
            console.warn('[Gamepads] Could not reload the controls from the config file:', error);
        }
    }

    /**
     * Resolves with the next new press (button, or axis half crossing the deadzone) on any pad,
     * for the BO to bind it to a MAUI key - or with an error if none comes within `timeoutMs`.
     * Works whether or not the window has the focus. That press does not reach MAUI's screens.
     */
    public static capturePress(timeoutMs: number): Promise<GamepadCaptureResult> {
        if (this.pendingCapture) {
            return Promise.resolve({error: 'A capture is already waiting for a press.'});
        }
        return new Promise(resolve => {
            const timer = setTimeout(() => this.finishCapture({
                error: `No press detected within ${Math.round(timeoutMs / 1000)}s - check that a gamepad `
                    + 'is connected to the cabinet, then try again.',
            }), timeoutMs);
            this.pendingCapture = {resolve, timer, baseline: new Map()};
            if (!this.running) {
                this.startCaptureLoop();
            }
        });
    }

    protected static startCaptureLoop() {
        if (!this.captureLoop) {
            this.captureLoop = setInterval(() => {
                for (const gamepad of navigator.getGamepads()) {
                    if (gamepad && gamepad.connected && gamepad.buttons) {
                        this.checkCapture(gamepad);
                    }
                }
            }, 16);
        }
    }

    protected static stopCaptureLoop() {
        if (this.captureLoop) {
            clearInterval(this.captureLoop);
            this.captureLoop = undefined;
        }
    }

    protected static finishCapture(result: GamepadCaptureResult) {
        const capture = this.pendingCapture;
        if (capture) {
            clearTimeout(capture.timer);
            this.pendingCapture = undefined;
            this.stopCaptureLoop();
            capture.resolve(result);
        }
    }

    protected static checkCapture(gamepad: Gamepad) {
        const capture = this.pendingCapture;
        if (!capture) {
            return;
        }
        const now = {
            buttons: gamepad.buttons.map(button => button.pressed),
            axes: gamepad.axes.map(value => Math.abs(value) > this.AXIS_DEADZONE ? Math.sign(value) : 0),
        };
        const before = capture.baseline.get(gamepad.index);
        // Released inputs become pressable again on the next frame.
        capture.baseline.set(gamepad.index, now);
        if (!before) {
            return;
        }
        let input: GamepadInput | undefined;
        const button = now.buttons.findIndex((pressed, index) => pressed && !before.buttons[index]);
        if (button !== -1) {
            input = {kind: 'button', index: button};
        } else {
            const axis = now.axes.findIndex((direction, index) => direction !== 0 && direction !== before.axes[index]);
            if (axis !== -1) {
                input = {kind: 'axis', index: axis, direction: now.axes[axis] > 0 ? 1 : 0};
            }
        }
        if (input) {
            this.finishCapture({mappingName: mappingNameOf(gamepad.mapping, gamepad.id), gamepadId: gamepad.id, input});
        }
    }

    /**
     * Keydowns are held back while a capture waits for its press (see capturePress()); keyups
     * always go through, so no screen is left thinking a key it saw pressed stays down.
     */
    protected static emit(eventName: 'gamepadKeydown' | 'gamepadKeyup', key: string, value: number) {
        if (eventName === 'gamepadKeydown' && this.pendingCapture) {
            return;
        }
        window.dispatchEvent(new CustomEvent(eventName, {detail: {key, value}}));
    }

    protected static resumePolling() {
        if (this.running) {
            return;
        }
        // The regular loop checks a pending capture itself (startGamepadListeners()).
        this.stopCaptureLoop();
        this.running = true;
        this.stop = false;
        this.startGamepadListeners();
    }

    public static startGamepadListeners() {
        if (this.stop) {
            this.running = false;
            return;
        }

        for (const navigatorGamepadsKey in navigator.getGamepads()) {
            if (!navigatorGamepadsKey) {
                continue;
            }
            const gamepad: Gamepad|null = navigator.getGamepads()[navigatorGamepadsKey];
            if (!gamepad || !gamepad.connected || !gamepad.buttons) {
                continue;
            }
            const gamepadsKey = gamepad.index;

            if (!this.gamepadKeyPressed[gamepadsKey]) {
                this.gamepadKeyPressed[gamepadsKey] = {axes: [], buttons: []};
            }

            // Many gamepads/arcade encoders - especially on Linux - never get tagged
            // mapping: "standard" by the browser and aren't in controllers.json either, so
            // fall back to the standard layout instead of silently dropping their input:
            // most of them follow it in practice regardless of what the browser reports.
            let mapping = this.controllerMapping[gamepad.mapping || gamepad.id];
            if (!mapping) {
                mapping = this.controllerMapping.standard;
                if (!this.warnedUnmappedGamepadIds.has(gamepad.id)) {
                    this.warnedUnmappedGamepadIds.add(gamepad.id);
                    console.warn(
                        `[Gamepads] No mapping found for gamepad "${gamepad.id}" `
                        + `(mapping: "${gamepad.mapping}") - falling back to the standard layout.`,
                    );
                }
            }

            // Joysticks. State is tracked for every axis/button, mapped or not, so an input bound
            // by a capture while held (see capturePress()) isn't seen as a fresh press once the
            // new mapping loads - only the events need a mapped key.
            gamepad.axes.forEach((value: number, index: number) => {
                if (!this.gamepadKeyPressed[gamepadsKey].axes[index]) {
                    this.gamepadKeyPressed[gamepadsKey].axes[index] = {
                        wasPressed: false as boolean,
                        lastPressedKey: null as string|null,
                    };
                }
                const axe = this.gamepadKeyPressed[gamepadsKey].axes[index];
                if (Math.abs(value) > this.AXIS_DEADZONE && !axe.wasPressed) {
                    axe.wasPressed = true;
                    axe.lastPressedKey = mapping.axes[index]?.[value > 0 ? 1 : 0] || null;
                    if (axe.lastPressedKey) {
                        this.emit('gamepadKeydown', axe.lastPressedKey, value);
                    }
                // Symmetric with the press threshold above, rather than an exact `=== 0`
                // check: plenty of sticks/hat-switches never rest at a perfect 0 (potentiometer
                // calibration drift, or a residual value from the driver), which left wasPressed
                // stuck true forever - blocking any further press on that axis after the first
                // one (e.g. "down" and "right" each working exactly once, then nothing).
                } else if (Math.abs(value) <= this.AXIS_DEADZONE && axe.wasPressed) {
                    axe.wasPressed = false;
                    if (axe.lastPressedKey) {
                        this.emit('gamepadKeyup', axe.lastPressedKey, value);
                    }
                }
            });

            gamepad.buttons.forEach((button: GamepadButton, index: number) => {
                const wasPressed = this.gamepadKeyPressed[gamepadsKey].buttons[index] === true;
                if (button.pressed !== wasPressed) {
                    this.gamepadKeyPressed[gamepadsKey].buttons[index] = button.pressed;
                    const key = mapping.buttons[index];
                    if (key) {
                        this.emit(button.pressed ? 'gamepadKeydown' : 'gamepadKeyup', key, button.value);
                    }
                }
            });

            // After the regular handling above, so the captured press's own keydown is held
            // back (emit()) and its state recorded as pressed.
            this.checkCapture(gamepad);
        }

        this.animationFrameRequest = requestAnimationFrame(this.startGamepadListeners.bind(this));
    }

    /**
     * Pauses the polling loop (e.g. on window blur, or once the last gamepad disconnects) and
     * flushes a gamepadKeyup for anything still held, so no view is left thinking a key stayed
     * pressed forever. Deliberately leaves the gamepadconnected/gamepaddisconnected listeners
     * registered - they're cheap to leave idle, and removing them here (as this used to) meant a
     * gamepad reconnecting after the last one disconnected was never detected again until the
     * next window blur/focus cycle happened to re-register them via init().
     */
    public static stopGamepadsListeners() {
        // A pending capture keeps going without the regular loop.
        if (this.pendingCapture) {
            this.startCaptureLoop();
        }
        this.stop = true;
        this.running = false;
        cancelAnimationFrame(this.animationFrameRequest);
        if (!navigator.getGamepads()) {
            return;
        }
        for (let gamepadIndex = 0; gamepadIndex < navigator.getGamepads().length; gamepadIndex++) {
            const gamepad = navigator.getGamepads()[gamepadIndex];
            if (!gamepad) {
                continue;
            }
            return this.stopGamepadListeners(gamepad, gamepadIndex);
        }
    }

    /**
     * Send gamepadKeyup on all pressed buttons
     * @param gamepad
     * @param gamepadIndex
     */
    public static stopGamepadListeners(gamepad: Gamepad, gamepadIndex: number) {
        // Same standard-layout fallback as the polling loop.
        const mapping = this.controllerMapping[gamepad.mapping || gamepad.id] ?? this.controllerMapping.standard;
        if (!mapping || !this.gamepadKeyPressed[gamepadIndex]) {
            return;
        }
        // Every input's state is tracked (see startGamepadListeners()), only the ones producing
        // a key get a keyup.
        for (let axesIndex = 0; axesIndex < this.gamepadKeyPressed[gamepadIndex].axes.length; axesIndex++) {
            const axe = this.gamepadKeyPressed[gamepadIndex].axes[axesIndex];
            if (axe && axe.wasPressed && axe.lastPressedKey) {
                window.dispatchEvent(new CustomEvent(
                    'gamepadKeyup',
                    { detail: {key: axe.lastPressedKey, value: 0}},
                ));
            }
        }
        for (let buttonIndex = 0; buttonIndex < this.gamepadKeyPressed[gamepadIndex].buttons.length; buttonIndex++) {
            if (this.gamepadKeyPressed[gamepadIndex].buttons[buttonIndex] && mapping.buttons[buttonIndex]) {
                window.dispatchEvent(new CustomEvent(
                    'gamepadKeyup',
                    { detail: {key: mapping.buttons[buttonIndex], value: 0}},
                ));
            }
        }
        delete this.gamepadKeyPressed[gamepadIndex];
    }

    protected static onGamepadconnected(e: Event) {
        const event: GamepadEvent = e as GamepadEvent;
        if (this.gamepadsIndex.indexOf(event.gamepad.index) === -1) {
            this.gamepadsIndex.push(event.gamepad.index);
        }
        this.emitGamepadCountUpdate();
        // Resumes polling if it was paused (e.g. this is the first gamepad reconnecting after
        // the previous one dropped out) - a no-op via the running guard otherwise.
        this.resumePolling();
    }

    protected static onGamepaddisconnected(e: Event) {
        const event: GamepadEvent = e as GamepadEvent;
        if (this.gamepadsIndex.indexOf(event.gamepad.index) === -1) {
            this.emitGamepadCountUpdate();
            return;
        }
        this.gamepadsIndex.splice(this.gamepadsIndex.indexOf(event.gamepad.index), 1);
        this.stopGamepadListeners((e as GamepadEvent).gamepad, (e as GamepadEvent).gamepad.index);
        if (!this.gamepadsIndex.length) {
            this.stopGamepadsListeners();
        }
        this.emitGamepadCountUpdate();
    }

    protected static emitGamepadCountUpdate() {
        window.dispatchEvent(new CustomEvent(
            'gamepadCountUpdate',
            { detail: {gamepadCount: this.gamepadsIndex.length }},
        ));
    }
}
