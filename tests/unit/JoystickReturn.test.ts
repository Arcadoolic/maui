import {describe, it, expect} from 'vitest';
import {JoystickReturn} from '@/class/JoystickReturn';
import type {JoystickNode} from '@/class/SharedJoysticks';

// arcade-digdug (2026-10-28): an 8BitDo Arcade Stick on its 2.4G receiver, which is a joystick
// only while the stick is awake, and a new input node each time it wakes.
const stick = (input: number): JoystickNode => ({
    number: 0, devicePath: '/dev/input/js0', chromiumKey: '/sys/devices/usb1/1-1/1-1:1.0/', inputPath: `/sys/devices/usb1/1-1/1-1:1.0/input/input${input}`,
    name: 'Microsoft X-Box 360 pad', vendorId: '045e', productId: '028e',
});

const otherPad = (input: number): JoystickNode => ({
    number: 1, devicePath: '/dev/input/js1', chromiumKey: '/sys/devices/usb1/1-2/1-2:1.0/', inputPath: `/sys/devices/usb1/1-2/1-2:1.0/input/input${input}`,
    name: 'Sony Interactive Entertainment Wireless Controller', vendorId: '054c', productId: '09cc',
});

describe('JoystickReturn', () => {
    it('tells when the joystick lost during the game is back', () => {
        const watch = new JoystickReturn([stick(15)]);

        expect(watch.update([stick(15)])).toBe(false);
        expect(watch.update([])).toBe(false);
        expect(watch.update([stick(17)])).toBe(true);
    });

    it('tells it too when it comes back between two looks', () => {
        const watch = new JoystickReturn([stick(15)]);

        expect(watch.update([stick(17)])).toBe(true);
    });

    it('lets the game go on when a joystick of another model is plugged in', () => {
        const watch = new JoystickReturn([stick(15)]);

        expect(watch.update([stick(15), otherPad(20)])).toBe(false);
    });

    it('lets the game go on when a joystick of another model is lost and back: MAME still has the one played with', () => {
        const watch = new JoystickReturn([stick(15)]);

        expect(watch.update([stick(15), otherPad(20)])).toBe(false);
        expect(watch.update([stick(15)])).toBe(false);
        expect(watch.update([stick(15), otherPad(21)])).toBe(false);
    });

    it('does nothing for a joystick missing at launch that comes later', () => {
        const watch = new JoystickReturn([]);

        expect(watch.update([stick(17)])).toBe(false);
    });

    it('tells when one of two sticks of the same model is lost and back, the other still there', () => {
        const second = {...stick(16), inputPath: '/sys/devices/usb1/1-3/1-3:1.0/input/input16'};
        const watch = new JoystickReturn([stick(15), second]);

        expect(watch.update([second])).toBe(false);
        expect(watch.update([second, stick(18)])).toBe(true);
    });
});
