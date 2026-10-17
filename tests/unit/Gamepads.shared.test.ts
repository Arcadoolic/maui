import {describe, it, expect, beforeEach, afterEach, vi} from 'vitest';
import Gamepads from '@/class/Gamepads.class';
import type {PolledPad, SharedJoysticks} from '@/class/SharedJoysticks';

// The Q*bert cabinet: Chromium reports a single Xin-Mo gamepad (player 2's joystick), while
// SharedJoysticks reads both of them from /dev/input/js*.
const XINMO_ID = 'Xin-Mo Xin-Mo Dual Arcade (Vendor: 16c0 Product: 05e1)';

function pad(index: number, id: string, pressedButtons: number[] = [], axes: number[] = [0, 0], mapping = ''): PolledPad {
    // 17 buttons: the W3C standard layout, d-pad (12-15) included.
    const buttons = Array.from({length: 17}, (_, button) => {
        const pressed = pressedButtons.includes(button);
        return {pressed, value: pressed ? 1 : 0};
    });
    return {index, id, mapping, axes, buttons};
}

describe('Gamepads with joysticks Chromium merges', () => {
    let dispatched: Array<{type: string, key: string}>;
    let browserPads: Array<PolledPad & {connected: boolean}>;
    let joysticks: PolledPad[];

    beforeEach(() => {
        dispatched = [];
        browserPads = [];
        joysticks = [];
        vi.stubGlobal('window', {
            addEventListener: () => undefined,
            dispatchEvent: (event: CustomEvent) => {
                dispatched.push({type: event.type, key: event.detail.key ?? event.detail.gamepadCount});
                return true;
            },
        });
        vi.stubGlobal('CustomEvent', class {
            public constructor(public type: string, public init: {detail: unknown}) {}
            public get detail() {
                return this.init.detail;
            }
        });
        vi.stubGlobal('navigator', {getGamepads: () => browserPads});
        vi.stubGlobal('requestAnimationFrame', () => 1);
        vi.stubGlobal('cancelAnimationFrame', () => undefined);
        Gamepads.gamepadsIndex = [];
        Gamepads.sharedJoysticks = {
            refresh: () => undefined,
            handles: (id: string) => id === XINMO_ID,
            list: () => joysticks,
            read: () => joysticks,
        } as unknown as SharedJoysticks;
    });

    afterEach(() => {
        Gamepads.stopGamepadsListeners();
        Gamepads.gamepadKeyPressed = [];
        Gamepads.sharedJoysticks = null;
        vi.unstubAllGlobals();
    });

    it("lets player 1's joystick drive the front, though Chromium never reports it", () => {
        joysticks = [pad(1000, XINMO_ID, [2]), pad(1001, XINMO_ID)];

        Gamepads.init();

        expect(dispatched).toContainEqual({type: 'gamepadKeydown', key: 'Enter'});
    });

    it("still reads player 2's joystick, once only", () => {
        joysticks = [pad(1000, XINMO_ID), pad(1001, XINMO_ID, [], [0, -1])];
        browserPads = [{...pad(0, XINMO_ID, [], [0, -1]), connected: true}];
        Gamepads.gamepadsIndex = [0];

        Gamepads.init();

        expect(dispatched.filter((event) => event.key === 'ArrowUp')).toEqual([{type: 'gamepadKeydown', key: 'ArrowUp'}]);
    });

    it('counts both joysticks, and not the merged pad Chromium reports', () => {
        joysticks = [pad(1000, XINMO_ID), pad(1001, XINMO_ID)];
        browserPads = [{...pad(0, XINMO_ID), connected: true}];
        Gamepads.gamepadsIndex = [0];

        Gamepads.init();

        expect(dispatched).toContainEqual({type: 'gamepadCountUpdate', key: 2});
    });

    it('keeps separate USB or Bluetooth pads on the Gamepad API, with their standard mapping', () => {
        browserPads = [
            {...pad(0, 'Xbox 360 Controller (STANDARD GAMEPAD Vendor: 045e Product: 028e)', [0], [0, 0], 'standard'), connected: true},
            {...pad(1, 'Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 09cc)', [12], [0, 0], 'standard'), connected: true},
        ];
        Gamepads.gamepadsIndex = [0, 1];

        Gamepads.init();

        expect(dispatched).toContainEqual({type: 'gamepadKeydown', key: 'Enter'});
        expect(dispatched).toContainEqual({type: 'gamepadKeydown', key: 'ArrowUp'});
        expect(dispatched).toContainEqual({type: 'gamepadCountUpdate', key: 2});
    });

    it('releases what was held on a joystick when the polling stops', () => {
        joysticks = [pad(1000, XINMO_ID, [8])];
        Gamepads.init();

        Gamepads.suspend();

        expect(dispatched).toContainEqual({type: 'gamepadKeyup', key: 'Space'});
        Gamepads.resume();
    });
});
