import {describe, it, expect} from 'vitest';
import {
    cleanOutput, describeFailure, pairBluetooth, parseAddresses, parseDevice, parsePower, readBluetoothState,
    removeBluetooth, scanBluetooth, setBluetoothPower, type BluetoothTools,
} from '@/class/BluetoothControl';

// The Raspberry Pi 3 cabinet (2026-10-08, bluetoothctl 5.82), adapter blocked by rfkill.
const PI_SHOW_OFF = `Controller B8:27:EB:11:F6:F2 (public)
\tManufacturer: 0x000f (15)
\tName: arcade-frogger
\tAlias: arcade-frogger
\tPowered: no
\tPowerState: off-blocked
\tDiscoverable: no
`;
const SHOW_ON = PI_SHOW_OFF.replace('Powered: no', 'Powered: yes');

const PAD = 'E4:17:D8:AA:BB:CC';
const TV = '64:95:6C:F0:FD:4F';
const NAMELESS = '42:29:F7:39:A7:68';

function info(name: string, extra: Record<string, string> = {}): string {
    const lines = {Name: name, Alias: name, Paired: 'no', Trusted: 'no', Connected: 'no', ...extra};
    return 'Device XX (public)\n' + Object.entries(lines).map(([key, value]) => `\t${key}: ${value}\n`).join('');
}

interface Fake {
    tools: BluetoothTools;
    typed: string[];
    ran: string[];
    closed: number;
    slept: number;
}

/**
 * A BlueZ that knows `devices` (address -> info text, changed by `onTyped` as commands are typed
 * into the open session) and never really waits.
 */
function fake(options: {
    show?: string;
    devices?: Record<string, string>;
    onTyped?: (command: string, devices: Record<string, string>, typed: string[]) => void;
    fail?: (command: string) => string | undefined;
    onRun?: (command: string, state: {show: string}) => void;
} = {}): Fake {
    const devices = {...options.devices};
    const state = {show: options.show ?? SHOW_ON};
    const result: Fake = {
        typed: [], ran: [], closed: 0, slept: 0,
        tools: {
            run: async (file, args) => {
                const command = `${file.replace(/^.*\//, '')} ${args.join(' ')}`;
                result.ran.push(command);
                options.onRun?.(command, state);
                const failure = options.fail?.(command);
                if (failure) {
                    throw new Error(failure);
                }
                if (args[0] === 'show') {
                    return state.show;
                }
                if (args[0] === 'devices') {
                    return Object.entries(devices)
                        .filter(([, text]) => args[1] !== 'Paired' || text.includes('Paired: yes'))
                        .map(([address]) => `Device ${address} whatever\n`).join('');
                }
                if (args[0] === 'info') {
                    if (!devices[args[1]]) {
                        throw new Error(`Device ${args[1]} not available`);
                    }
                    return devices[args[1]];
                }
                if (args[0] === 'remove') {
                    delete devices[args[1]];
                }
                return '';
            },
            open: () => ({
                send: command => {
                    result.typed.push(command);
                    options.onTyped?.(command, devices, result.typed);
                },
                close: () => { result.closed++; },
            }),
            sleep: async () => { result.slept++; },
        },
    };
    return result;
}

describe('cleanOutput', () => {
    it('drops colours, prompts and the padding between messages', () => {
        const raw = '\x1b[0;94m[bluetoothctl]>\x1b[0m \r                 \rAgent registered\n[bluetoothctl]> Discovery started\r\n';
        expect(cleanOutput(raw)).toEqual(['Agent registered', 'Discovery started']);
    });
});

describe('describeFailure', () => {
    it('gives bluetoothctl\'s own words, which it prints on its standard output', () => {
        expect(describeFailure('Device 00:11:22:33:44:55 not available\n', '', {})).toBe('Device 00:11:22:33:44:55 not available');
        expect(describeFailure('', '', {code: 'ENOENT'})).toBe('bluetoothctl is not installed.');
        expect(describeFailure('', '', {killed: true})).toBe('Bluetooth did not answer in time.');
    });
});

describe('parsePower', () => {
    it('tells an adapter that is off from one that is on or missing', () => {
        expect(parsePower(PI_SHOW_OFF)).toBe('off');
        expect(parsePower(SHOW_ON)).toBe('on');
        expect(parsePower('No default controller available\n')).toBe('missing');
    });
});

describe('parseAddresses', () => {
    it('reads the addresses of a device list', () => {
        expect(parseAddresses(`Device ${PAD} 8BitDo Pro 2\nDevice ${NAMELESS} 42-29-F7-39-A7-68\nnoise\n`)).toEqual([PAD, NAMELESS]);
    });
});

describe('parseDevice', () => {
    it('reads a connected gamepad with its battery', () => {
        const text = info('8BitDo Pro 2', {Paired: 'yes', Connected: 'yes', Icon: 'input-gaming', 'Battery Percentage': '0x50 (80)'});
        expect(parseDevice(PAD, text)).toEqual({
            address: PAD, name: '8BitDo Pro 2', gamepad: true, paired: true, connected: true, battery: 80,
        });
    });

    it('gives no name to a device that only shows its address', () => {
        const device = parseDevice(NAMELESS, info('42-29-F7-39-A7-68'));
        expect(device.name).toBe('');
        expect(device.gamepad).toBe(false);
        expect(device.battery).toBeNull();
    });
});

describe('readBluetoothState', () => {
    it('lists the paired devices of an adapter that is on', async () => {
        const {tools} = fake({devices: {[PAD]: info('8BitDo Pro 2', {Paired: 'yes'}), [TV]: info('TV')}});
        const state = await readBluetoothState(tools);
        expect(state?.power).toBe('on');
        expect(state?.paired.map(device => device.name)).toEqual(['8BitDo Pro 2']);
    });

    it('is null without bluetoothctl', async () => {
        expect(await readBluetoothState(fake({fail: () => 'bluetoothctl is not installed.'}).tools)).toBeNull();
    });
});

describe('setBluetoothPower', () => {
    it('lifts the radio block before powering the adapter, and takes a busy BlueZ that ends up on as done', async () => {
        const bluez = fake({
            show: PI_SHOW_OFF,
            fail: command => command === 'bluetoothctl power on' ? 'Failed to set power on: org.bluez.Error.Busy' : undefined,
            onRun: (command, state) => {
                if (command === 'bluetoothctl power on') {
                    state.show = SHOW_ON;
                }
            },
        });

        await setBluetoothPower(true, bluez.tools);

        expect(bluez.ran.slice(0, 2)).toEqual(['rfkill unblock bluetooth', 'bluetoothctl power on']);
    });

    it('blocks the radio when switching off, so that it stays off after a restart', async () => {
        const bluez = fake({onRun: (command, state) => {
            if (command === 'bluetoothctl power off') {
                state.show = PI_SHOW_OFF;
            }
        }});

        await setBluetoothPower(false, bluez.tools);

        expect(bluez.ran.slice(0, 2)).toEqual(['bluetoothctl power off', 'rfkill block bluetooth']);
    });

    it('rejects with BlueZ\'s reason when the adapter does not follow', async () => {
        const bluez = fake({show: PI_SHOW_OFF, fail: command => command.includes('power on') ? 'Failed to set power on: org.bluez.Error.Failed' : undefined});
        await expect(setBluetoothPower(true, bluez.tools)).rejects.toThrow('org.bluez.Error.Failed');
    });
});

describe('scanBluetooth', () => {
    it('gives the named devices that are not paired, gamepads first, and ends the search', async () => {
        const bluez = fake({devices: {
            [TV]: info('[LG] webOS TV'),
            [NAMELESS]: info('42-29-F7-39-A7-68'),
            [PAD]: info('Xbox Wireless Controller', {Icon: 'input-gaming'}),
            'AA:BB:CC:DD:EE:FF': info('Old pad', {Paired: 'yes', Icon: 'input-gaming'}),
        }});

        const found = await scanBluetooth(10, bluez.tools);

        expect(found.map(device => device.name)).toEqual(['Xbox Wireless Controller', '[LG] webOS TV']);
        expect(bluez.typed).toEqual(['scan on', 'scan off']);
        expect(bluez.closed).toBe(1);
    });

    it('ends the search when listing fails', async () => {
        const bluez = fake({fail: command => command.includes('devices') ? 'boom' : undefined});
        await expect(scanBluetooth(10, bluez.tools)).rejects.toThrow('boom');
        expect(bluez.closed).toBe(1);
    });
});

describe('pairBluetooth', () => {
    it('searches until the device answers, trusts it, pairs it and connects it', async () => {
        const bluez = fake({onTyped: (command, devices) => {
            if (command === 'scan on') {
                devices[PAD] = info('8BitDo Pro 2', {Icon: 'input-gaming'});
            } else if (command === `pair ${PAD}`) {
                devices[PAD] = info('8BitDo Pro 2', {Paired: 'yes'});
            } else if (command === `connect ${PAD}`) {
                devices[PAD] = info('8BitDo Pro 2', {Paired: 'yes', Connected: 'yes'});
            }
        }});

        const device = await pairBluetooth(PAD, bluez.tools);

        expect(device).toMatchObject({paired: true, connected: true});
        expect(bluez.typed).toEqual(['scan on', `trust ${PAD}`, `pair ${PAD}`, `connect ${PAD}`, 'scan off']);
        expect(bluez.closed).toBe(1);
    });

    it('takes a pad that pairs without connecting as paired', async () => {
        const bluez = fake({
            devices: {[PAD]: info('8BitDo Pro 2')},
            onTyped: (command, devices) => {
                if (command === `pair ${PAD}`) {
                    devices[PAD] = info('8BitDo Pro 2', {Paired: 'yes'});
                }
            },
        });

        expect(await pairBluetooth(PAD, bluez.tools)).toMatchObject({paired: true, connected: false});
    });

    it('gives up on a device that no longer answers, without trying to pair it', async () => {
        const bluez = fake();
        await expect(pairBluetooth(PAD, bluez.tools)).rejects.toThrow('pairing mode');
        expect(bluez.typed).toEqual(['scan on', 'scan off']);
        expect(bluez.closed).toBe(1);
    });

    it('confirms meanwhile and gives up on a device that never accepts', async () => {
        const bluez = fake({devices: {[PAD]: info('8BitDo Pro 2')}});
        await expect(pairBluetooth(PAD, bluez.tools)).rejects.toThrow('did not accept');
        expect(bluez.typed).toContain('yes');
        expect(bluez.typed).not.toContain(`connect ${PAD}`);
    });

    it('types nothing for what is not an address', async () => {
        const bluez = fake();
        await expect(pairBluetooth('scan off\nremove *', bluez.tools)).rejects.toThrow('Not a Bluetooth address');
        expect(bluez.typed).toEqual([]);
    });
});

describe('removeBluetooth', () => {
    it('forgets a device, and refuses what is not an address', async () => {
        const bluez = fake({devices: {[PAD]: info('8BitDo Pro 2', {Paired: 'yes'})}});
        await removeBluetooth(PAD, bluez.tools);
        expect(bluez.ran).toEqual([`bluetoothctl remove ${PAD}`]);
        await expect(removeBluetooth('*', bluez.tools)).rejects.toThrow('Not a Bluetooth address');
    });
});
