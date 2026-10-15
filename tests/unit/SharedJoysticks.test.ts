import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {mkdirSync, mkdtempSync, openSync, rmSync, symlinkSync, writeFileSync} from 'fs';
import {tmpdir} from 'os';
import {join} from 'path';
import {
    applyJoydevEvents, chromiumKey, findSharedJoysticks, JoydevPad, listJoysticks, SharedJoysticks, type JoystickNode,
} from '@/class/SharedJoysticks';

// The Q*bert cabinet (2026-10-15): a Xin-Mo Dual Arcade the kernel splits into js0 (player 1) and
// js1 (player 2), both under the same HID device.
const XINMO_HID = '/sys/devices/pci0000:00/0000:00:1a.0/usb1/1-1/1-1.4/1-1.4:1.0/0003:16C0:05E1.0003';

function jsEvent(type: number, number: number, value: number): Buffer {
    const event = Buffer.alloc(8);
    event.writeUInt32LE(0, 0);
    event.writeInt16LE(value, 4);
    event[6] = type;
    event[7] = number;
    return event;
}

describe('chromiumKey', () => {
    it('gives both joysticks of a two-player encoder the same key, as Chromium does', () => {
        expect(chromiumKey(`${XINMO_HID}/input/input8`)).toBe(`${XINMO_HID}/`);
        expect(chromiumKey(`${XINMO_HID}/input/input9`)).toBe(`${XINMO_HID}/`);
    });

    it('gives every uinput joystick the same key: virtual pads made that way would be merged too', () => {
        expect(chromiumKey('/sys/devices/virtual/input/input12')).toBe('/sys/devices/virtual/');
        expect(chromiumKey('/sys/devices/virtual/input/input13')).toBe('/sys/devices/virtual/');
    });

    it('tells apart pads with a HID device of their own (USB, Bluetooth, uhid)', () => {
        const keys = [
            '/sys/devices/pci0000:00/0000:00:1a.0/usb1/1-1/1-1.2/1-1.2:1.0/0003:045E:028E.0004/input/input10',
            '/sys/devices/pci0000:00/0000:00:1a.0/usb1/1-1/1-1.3/1-1.3:1.0/0003:045E:028E.0005/input/input11',
            '/sys/devices/pci0000:00/0000:00:14.0/usb1/1-5/1-5:1.0/bluetooth/hci0/hci0:256/0005:054C:09CC.0006/input/input12',
            '/sys/devices/virtual/misc/uhid/0005:2DC8:6001.0007/input/input13',
        ].map(chromiumKey);

        expect(new Set(keys).size).toBe(4);
    });
});

describe('findSharedJoysticks', () => {
    const node = (number: number, key: string, vendorId: string, productId: string): JoystickNode => ({
        number, devicePath: `/dev/input/js${number}`, chromiumKey: key, name: 'pad', vendorId, productId,
    });

    it('keeps the joysticks Chromium merges', () => {
        const nodes = [node(0, 'xinmo/', '16c0', '05e1'), node(1, 'xinmo/', '16c0', '05e1')];

        expect(findSharedJoysticks(nodes).map((n) => n.number)).toEqual([0, 1]);
    });

    it('leaves two separate USB or Bluetooth pads to the Gamepad API, even of the same model', () => {
        const nodes = [
            node(0, 'usb-a/', '045e', '028e'),
            node(1, 'usb-b/', '045e', '028e'),
            node(2, 'bluetooth/', '054c', '09cc'),
        ];

        expect(findSharedJoysticks(nodes)).toEqual([]);
    });

    it('takes every pad of a merged model, so that one model is never read both ways', () => {
        const nodes = [
            node(0, 'xinmo-a/', '16c0', '05e1'),
            node(1, 'xinmo-a/', '16c0', '05e1'),
            node(2, 'xinmo-b/', '16c0', '05e1'),
            node(3, 'usb/', '045e', '028e'),
        ];

        expect(findSharedJoysticks(nodes).map((n) => n.number)).toEqual([0, 1, 2]);
    });
});

describe('listJoysticks', () => {
    let root: string;

    beforeEach(() => {
        root = mkdtempSync(join(tmpdir(), 'maui-js-'));
        mkdirSync(join(root, 'class'));
        for (const [js, inputNode] of [['js0', 'input8'], ['js1', 'input9']]) {
            const inputDir = join(root, 'devices', '0003:16C0:05E1.0003', 'input', inputNode);
            mkdirSync(join(inputDir, js), {recursive: true});
            mkdirSync(join(inputDir, 'id'));
            writeFileSync(join(inputDir, 'name'), 'Xin-Mo Xin-Mo Dual Arcade\n');
            writeFileSync(join(inputDir, 'id', 'vendor'), '16c0\n');
            writeFileSync(join(inputDir, 'id', 'product'), '05e1\n');
            symlinkSync(join(inputDir, js), join(root, 'class', js));
        }
        writeFileSync(join(root, 'class', 'event5'), '');
    });

    afterEach(() => {
        rmSync(root, {recursive: true, force: true});
    });

    it('describes each joystick from sysfs, keyed like Chromium', () => {
        const nodes = listJoysticks(join(root, 'class'));

        expect(nodes.map((n) => [n.devicePath, n.name, n.vendorId, n.productId])).toEqual([
            ['/dev/input/js0', 'Xin-Mo Xin-Mo Dual Arcade', '16c0', '05e1'],
            ['/dev/input/js1', 'Xin-Mo Xin-Mo Dual Arcade', '16c0', '05e1'],
        ]);
        expect(nodes[0].chromiumKey).toBe(nodes[1].chromiumKey);
    });

    it('opens both joysticks and leaves the Gamepad API pad of their model out', () => {
        const opened: string[] = [];
        const shared = new SharedJoysticks(join(root, 'class'), (devicePath) => {
            opened.push(devicePath);
            return openSync(join(root, 'class', 'event5'), 'r');
        });

        shared.refresh();

        expect(opened).toEqual(['/dev/input/js0', '/dev/input/js1']);
        expect(shared.list().map((pad) => pad.id)).toEqual([
            'Xin-Mo Xin-Mo Dual Arcade (Vendor: 16c0 Product: 05e1)',
            'Xin-Mo Xin-Mo Dual Arcade (Vendor: 16c0 Product: 05e1)',
        ]);
        expect(shared.handles('Xin-Mo Xin-Mo Dual Arcade (Vendor: 16c0 Product: 05e1)')).toBe(true);
        expect(shared.handles('Xbox 360 Controller (STANDARD GAMEPAD Vendor: 045e Product: 028e)')).toBe(false);
    });

    it('leaves the whole model to the Gamepad API when one of its joysticks cannot be opened', () => {
        const shared = new SharedJoysticks(join(root, 'class'), (devicePath) => {
            if (devicePath === '/dev/input/js1') {
                throw Object.assign(new Error('EACCES'), {code: 'EACCES'});
            }
            return openSync(join(root, 'class', 'event5'), 'r');
        });

        shared.refresh();

        expect(shared.list()).toEqual([]);
        expect(shared.handles('Xin-Mo Xin-Mo Dual Arcade (Vendor: 16c0 Product: 05e1)')).toBe(false);
    });

    it('finds nothing where sysfs has no input class (macOS, Windows)', () => {
        expect(listJoysticks(join(root, 'nowhere'))).toEqual([]);
    });
});

describe('reading a joystick', () => {
    it('applies button and axis events, the initial state included', () => {
        const axes: number[] = [];
        const buttons: boolean[] = [];
        const data = Buffer.concat([
            jsEvent(0x81, 2, 1), // initial state: button 2 held
            jsEvent(0x82, 0, 0), // initial state: axis 0 at rest
            jsEvent(0x02, 1, -32767), // up
            jsEvent(0x01, 8, 1),
            jsEvent(0x01, 2, 0),
        ]);

        applyJoydevEvents(data, data.length, axes, buttons);

        expect(axes).toEqual([0, -1]);
        expect(buttons[2]).toBe(false);
        expect(buttons[8]).toBe(true);
    });

    it('drains what the kernel queued into a pad the poller can read', () => {
        const dir = mkdtempSync(join(tmpdir(), 'maui-js-'));
        const file = join(dir, 'js0');
        writeFileSync(file, Buffer.concat([jsEvent(0x02, 0, 32767), jsEvent(0x01, 0, 1)]));
        const pad = new JoydevPad({
            number: 0, devicePath: file, chromiumKey: '', name: 'Xin-Mo Xin-Mo Dual Arcade', vendorId: '16c0', productId: '05e1',
        }, openSync(file, 'r'));

        expect(pad.drain()).toBe(true);
        expect(pad.axes).toEqual([1]);
        expect(pad.buttons).toEqual([{pressed: true, value: 1}]);
        expect(pad.index).toBe(1000);

        pad.close();
        rmSync(dir, {recursive: true, force: true});
    });
});
