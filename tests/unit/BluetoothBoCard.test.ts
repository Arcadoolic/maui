import {describe, it, expect} from 'vitest';
import {renderBluetoothCard} from '@/class/BluetoothBoCard';
import type {BluetoothDevice} from '@/class/BluetoothControl';

function device(overrides: Partial<BluetoothDevice> = {}): BluetoothDevice {
    return {address: 'E4:17:D8:AA:BB:CC', name: '8BitDo Pro 2', gamepad: true, paired: false, connected: false, battery: null, ...overrides};
}

describe('renderBluetoothCard', () => {
    it('offers nothing without an adapter', () => {
        const html = renderBluetoothCard({power: 'missing', paired: []});
        expect(html).toContain('no Bluetooth adapter');
        expect(html).not.toContain('<form');
    });

    it('only offers to switch the adapter on while it is off', () => {
        const html = renderBluetoothCard({power: 'off', paired: []});
        expect(html).toContain('Turn Bluetooth on');
        expect(html).not.toContain('/maui/bluetooth/scan');
    });

    it('lists the paired devices with their state and battery', () => {
        const html = renderBluetoothCard({power: 'on', paired: [device({paired: true, connected: true, battery: 80})]});
        expect(html).toContain('Connected - battery 80%');
        expect(html).toContain('action="/maui/bluetooth/remove"');
        expect(html).not.toContain('action="/maui/bluetooth/pair"');
    });

    it('shows the gamepads found, the other devices folded away', () => {
        const html = renderBluetoothCard({power: 'on', paired: []}, {found: [
            device(),
            device({address: '64:95:6C:F0:FD:4F', name: '"><script>', gamepad: false}),
        ]});
        expect(html.match(/action="\/maui\/bluetooth\/pair"/g)).toHaveLength(2);
        expect(html).toContain('Other devices in range (1)');
        expect(html.indexOf('8BitDo Pro 2')).toBeLessThan(html.indexOf('<details>'));
        expect(html).not.toContain('<script>');
    });

    it('says so when a search found no gamepad', () => {
        const html = renderBluetoothCard({power: 'on', paired: []}, {found: []});
        expect(html).toContain('No gamepad found');
    });
});
