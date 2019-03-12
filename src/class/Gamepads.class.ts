import ControllerMappingJson from '../assets/controllers.json';

export default class Gamepads {
    public static gamepadCount: number = 0;
    public static animationFrameRequest: number|null = null;
    public static controllerMapping: {[key: string]: ControllerMapping} = ControllerMappingJson;
    public static gamepadKeyPressed:
        Array<{buttons: boolean[], axes: Array<{wasPressed: boolean, lastPressedKey: string|null}>}> = [];

    public static init() {
        window.addEventListener('gamepadconnected', (e) => {
            this.gamepadCount++;
            if (this.gamepadCount === 1) {
                this.startGamepadListeners();
            }
            this.emitGamepadCountUpdate();
        });

        window.addEventListener('gamepaddisconnected', (e) => {
            this.gamepadCount--;
            this.stopGamepadListeners((e as GamepadEvent).gamepad, (e as GamepadEvent).gamepad.index);
            if (!this.gamepadCount) {
                this.stopGamepadsListeners();
            }
            this.emitGamepadCountUpdate();
        });

    }

    public static emitGamepadCountUpdate() {
        window.dispatchEvent(new CustomEvent(
            'gamepadCountUpdate',
            { detail: {gamepadCount: this.gamepadCount }},
        ));
    }

    public static startGamepadListeners() {
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

            const mapping = this.controllerMapping[gamepad.mapping || gamepad.id];
            if (!mapping) {
                continue;
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
                    if (value !== 0 && !axe.wasPressed) {
                        eventName = 'gamepadKeydown';
                        axe.wasPressed = true;
                        axe.lastPressedKey = value > 0 ?
                            mapping.axes[index][1] : mapping.axes[index][0];
                    } else if (value === 0 && axe.wasPressed) {
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
                    if (button.pressed) {
                        eventName = 'gamepadKeydown';
                        this.gamepadKeyPressed[gamepadsKey].buttons[index] = true;
                    } else if (this.gamepadKeyPressed[gamepadsKey].buttons[index]) {
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
     * Stop gamepads loop
     */
    public static stopGamepadsListeners() {
        if (this.animationFrameRequest) {
            cancelAnimationFrame(this.animationFrameRequest);
        }
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
}
