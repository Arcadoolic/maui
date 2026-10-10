import {describe, it, expect, beforeEach, afterEach, vi} from 'vitest';
import Gamepads from '@/class/Gamepads.class';

// The polling loop is a requestAnimationFrame chain: counting the frames asked for tells whether
// the controllers are being read. No gamepad is plugged in (getGamepads() is empty), one is only
// known (gamepadsIndex), which is what makes init() start the loop.

describe('Gamepads.suspend / resume', () => {
    let framesAsked = 0;

    beforeEach(() => {
        framesAsked = 0;
        vi.stubGlobal('window', {addEventListener: () => undefined, dispatchEvent: () => true});
        vi.stubGlobal('navigator', {getGamepads: () => []});
        vi.stubGlobal('requestAnimationFrame', () => ++framesAsked);
        vi.stubGlobal('cancelAnimationFrame', () => undefined);
        Gamepads.gamepadsIndex = [0];
    });

    afterEach(() => {
        Gamepads.resume();
        Gamepads.stopGamepadsListeners();
        Gamepads.gamepadsIndex = [];
        vi.unstubAllGlobals();
    });

    it('reads the controllers once started', () => {
        Gamepads.init();

        expect(framesAsked).toBe(1);
    });

    it('stops reading them while a game runs, whatever asks to start again', () => {
        Gamepads.init();
        Gamepads.suspend();
        framesAsked = 0;

        // What App.vue does when the window gets its focus back during the game.
        Gamepads.init();

        expect(framesAsked).toBe(0);
    });

    it('reads them again once the game was quit', () => {
        Gamepads.init();
        Gamepads.suspend();
        framesAsked = 0;

        Gamepads.resume();

        expect(framesAsked).toBe(1);
    });
});
