import ControllerMappingJson from '../assets/controllers.json';

export default class Gamepads {
    // Threshold an axis must cross to count as "pressed", and fall back under to count as
    // "released" - the same value both ways so release is never held hostage to a stick/hat
    // resting at some non-zero value instead of a perfect 0.
    protected static readonly AXIS_DEADZONE = 0.4;
    public static gamepadsIndex: number[] = [];
    public static animationFrameRequest: number = 0;
    public static controllerMapping: {[key: string]: ControllerMapping} = ControllerMappingJson;
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

    protected static resumePolling() {
        if (this.running) {
            return;
        }
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

            // Joysticks
            gamepad.axes.forEach((value: number, index: number) => {
                let eventName: string|null = null;
                if (mapping.axes[index]) {
                    if (!this.gamepadKeyPressed[gamepadsKey].axes[index]) {
                        this.gamepadKeyPressed[gamepadsKey].axes[index] = {
                            wasPressed: false as boolean,
                            lastPressedKey: null as string|null,
                        };
                    }
                    const axe = this.gamepadKeyPressed[gamepadsKey].axes[index];
                    if (Math.abs(value) > this.AXIS_DEADZONE && !axe.wasPressed) {
                        eventName = 'gamepadKeydown';
                        axe.wasPressed = true;
                        axe.lastPressedKey = value > 0 ?
                            mapping.axes[index][1] : mapping.axes[index][0];
                    // Symmetric with the press threshold above, rather than an exact `=== 0`
                    // check: plenty of sticks/hat-switches never rest at a perfect 0 (potentiometer
                    // calibration drift, or a residual value from the driver), which left wasPressed
                    // stuck true forever - blocking any further press on that axis after the first
                    // one (e.g. "down" and "right" each working exactly once, then nothing).
                    } else if (Math.abs(value) <= this.AXIS_DEADZONE && axe.wasPressed) {
                        eventName = 'gamepadKeyup';
                        axe.wasPressed = false;
                    }

                    if (eventName) {
                        const event = new CustomEvent(eventName, {
                            detail: {
                                key: axe.lastPressedKey,
                                value,
                            },
                        });
                        window.dispatchEvent(event);
                    }
                }
            });

            gamepad.buttons.forEach((button: GamepadButton, index: number) => {
                let eventName: string|null = null;
                if (mapping.buttons[index]) {
                    const wasPressed = this.gamepadKeyPressed[gamepadsKey].buttons[index];
                    if (button.pressed && !wasPressed) {
                        eventName = 'gamepadKeydown';
                        this.gamepadKeyPressed[gamepadsKey].buttons[index] = true;
                    } else if (!button.pressed && wasPressed) {
                        eventName = 'gamepadKeyup';
                        this.gamepadKeyPressed[gamepadsKey].buttons[index] = false;
                    }

                    if (eventName) {
                        const event = new CustomEvent(eventName, {
                            detail: {
                                key: mapping.buttons[index],
                                value: button.value,
                            },
                        });
                        window.dispatchEvent(event);
                    }
                }
            });
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
        const mapping = this.controllerMapping[gamepad.mapping || gamepad.id];
        if (!mapping || !this.gamepadKeyPressed[gamepadIndex]) {
            return;
        }
        for (let axesIndex = 0; axesIndex < this.gamepadKeyPressed[gamepadIndex].axes.length; axesIndex++) {
            const axe = this.gamepadKeyPressed[gamepadIndex].axes[axesIndex];
            if (axe && axe.wasPressed) {
                window.dispatchEvent(new CustomEvent(
                    'gamepadKeyup',
                    { detail: {key: axe.lastPressedKey, value: 0}},
                ));
            }
        }
        for (let buttonIndex = 0; buttonIndex < this.gamepadKeyPressed[gamepadIndex].buttons.length; buttonIndex++) {
            if (this.gamepadKeyPressed[gamepadIndex].buttons[buttonIndex]) {
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
