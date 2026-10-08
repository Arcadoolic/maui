import {execFile, spawn} from 'child_process';

// The Bluetooth gamepads of a dedicated cabinet, paired from the BO through BlueZ's bluetoothctl:
// without it pairing takes a keyboard or SSH. No sudo: BlueZ's D-Bus policy lets any user talk to
// it and /dev/rfkill is open to the kiosk user (checked on the Raspberry Pi cabinet, 2026-10-08).
// Electron-free.
//
// A search only lasts as long as the bluetoothctl that asked for it, and BlueZ forgets a device
// that is not paired half a minute after: searching and pairing each keep one bluetoothctl open
// (BluetoothSession), fed through its input. Its output is never read - it comes late and in
// pieces through a pipe - what happened is asked to separate one-shot bluetoothctl runs.

const QUICK_MS = 8000;
const POLL_MS = 1000;
export const SCAN_SECONDS = 10;
const FIND_SECONDS = 15;
const PAIR_SECONDS = 30;
const CONNECT_SECONDS = 10;
const POWER_SECONDS = 5;

// Not in the PATH of a Debian user.
const RFKILL = '/usr/sbin/rfkill';
const ADDRESS_PATTERN = /^([0-9A-F]{2}:){5}[0-9A-F]{2}$/;

export interface BluetoothSession {
    send(command: string): void;
    close(): void;
}

export interface BluetoothTools {
    /** Runs the command and resolves to its output; rejects with a message fit for the BO. */
    run(file: string, args: string[], timeoutMs: number): Promise<string>;
    /** A bluetoothctl left open, to type commands into. */
    open(): BluetoothSession;
    sleep(ms: number): Promise<void>;
}

/** bluetoothctl's output without its colours and prompts, one message per line. */
export function cleanOutput(text: string): string[] {
    return text
        // eslint-disable-next-line no-control-regex
        .replace(/\x1b\[[0-9;?]*[A-Za-z]|[\x01\x02]/g, '')
        .split(/[\r\n]+/)
        .map(line => line.replace(/^\[[^\]]*\][>#]\s*/, '').trim())
        .filter(line => line.length > 0);
}

/** What to tell the BO's user about a failed command: its own first words, errors being printed on either stream. */
export function describeFailure(stdout: string, stderr: string, error: {code?: unknown; killed?: boolean}): string {
    const line = cleanOutput(stderr)[0] ?? cleanOutput(stdout)[0];
    if (line) {
        return line;
    }
    if (error.code === 'ENOENT') {
        return 'bluetoothctl is not installed.';
    }
    return error.killed ? 'Bluetooth did not answer in time.' : 'Bluetooth refused the request.';
}

const systemTools: BluetoothTools = {
    run: (file, args, timeoutMs) => new Promise((resolve, reject) => {
        // LC_ALL=C: "yes", "Powered" and the like are what is parsed.
        execFile(file, args, {encoding: 'utf8', timeout: timeoutMs, env: {...process.env, LC_ALL: 'C'}}, (error, stdout, stderr) => {
            if (error) {
                reject(new Error(describeFailure(stdout, stderr, error)));
            } else {
                resolve(stdout);
            }
        });
    }),
    open: () => {
        // NoInputNoOutput: a gamepad has neither screen nor keys to confirm a code with.
        const child = spawn('bluetoothctl', ['--agent', 'NoInputNoOutput'], {stdio: ['pipe', 'ignore', 'ignore']});
        child.on('error', () => undefined);
        child.stdin.on('error', () => undefined);
        return {
            send: command => {
                if (child.stdin.writable) {
                    child.stdin.write(`${command}\n`);
                }
            },
            close: () => {
                if (child.stdin.writable) {
                    child.stdin.end('quit\n');
                }
                setTimeout(() => child.kill(), 2000).unref();
            },
        };
    },
    sleep: ms => new Promise(resolve => setTimeout(resolve, ms)),
};

export interface BluetoothDevice {
    address: string;
    name: string;
    // What the device says it is (BlueZ's "input-gaming" icon). Some pads only say so once paired.
    gamepad: boolean;
    paired: boolean;
    connected: boolean;
    // Percent, null when the device does not report it.
    battery: number | null;
}

export interface BluetoothState {
    // "missing": no adapter, or BlueZ not running.
    power: 'missing' | 'off' | 'on';
    paired: BluetoothDevice[];
}

function fields(text: string): Map<string, string> {
    const found = new Map<string, string>();
    for (const line of cleanOutput(text)) {
        const match = /^([A-Za-z ]+): (.*)$/.exec(line);
        if (match && !found.has(match[1])) {
            found.set(match[1], match[2]);
        }
    }
    return found;
}

/** `bluetoothctl show`. */
export function parsePower(text: string): BluetoothState['power'] {
    if (!cleanOutput(text).some(line => line.startsWith('Controller '))) {
        return 'missing';
    }
    return fields(text).get('Powered') === 'yes' ? 'on' : 'off';
}

/** The addresses of `bluetoothctl devices`. */
export function parseAddresses(text: string): string[] {
    return cleanOutput(text)
        .map(line => /^Device ([0-9A-F:]{17})\b/.exec(line)?.[1])
        .filter((address): address is string => !!address && ADDRESS_PATTERN.test(address));
}

/** `bluetoothctl info <address>`. A device without a name of its own shows its address instead: its name is then empty. */
export function parseDevice(address: string, text: string): BluetoothDevice {
    const info = fields(text);
    const name = info.get('Alias') ?? info.get('Name') ?? '';
    const battery = /\((\d+)\)/.exec(info.get('Battery Percentage') ?? '');
    return {
        address,
        name: name.replace(/[-:]/g, '').toUpperCase() === address.replace(/:/g, '') ? '' : name,
        gamepad: info.get('Icon') === 'input-gaming',
        paired: info.get('Paired') === 'yes',
        connected: info.get('Connected') === 'yes',
        battery: battery ? Number(battery[1]) : null,
    };
}

/** The device as BlueZ knows it now, null when it does not (never seen, or forgotten since). */
async function readDevice(address: string, tools: BluetoothTools): Promise<BluetoothDevice | null> {
    try {
        return parseDevice(address, await tools.run('bluetoothctl', ['info', address], QUICK_MS));
    } catch {
        return null;
    }
}

async function readDevices(filter: string[], tools: BluetoothTools): Promise<BluetoothDevice[]> {
    const addresses = parseAddresses(await tools.run('bluetoothctl', ['devices', ...filter], QUICK_MS));
    const devices: BluetoothDevice[] = [];
    // A few at a time: dozens of devices answer a search in a block of flats.
    for (let index = 0; index < addresses.length; index += 4) {
        const batch = await Promise.all(addresses.slice(index, index + 4).map(address => readDevice(address, tools)));
        devices.push(...batch.filter((device): device is BluetoothDevice => device !== null));
    }
    return devices;
}

/** What the BO's Bluetooth card shows, null when bluetoothctl is not there to ask. */
export async function readBluetoothState(tools: BluetoothTools = systemTools): Promise<BluetoothState | null> {
    try {
        const power = parsePower(await tools.run('bluetoothctl', ['show'], QUICK_MS));
        return {power, paired: power === 'missing' ? [] : await readDevices(['Paired'], tools)};
    } catch {
        return null;
    }
}

async function isPowered(tools: BluetoothTools): Promise<boolean> {
    return parsePower(await tools.run('bluetoothctl', ['show'], QUICK_MS).catch(() => '')) === 'on';
}

/**
 * Switches the adapter on or off, radio block included (rfkill, which is what survives a restart:
 * BlueZ powers an adapter that is not blocked on its own). Rejects when it did not follow.
 */
export async function setBluetoothPower(on: boolean, tools: BluetoothTools = systemTools): Promise<void> {
    if (on) {
        await tools.run(RFKILL, ['unblock', 'bluetooth'], QUICK_MS).catch(() => undefined);
    }
    // "Busy" while BlueZ is already at it: what counts is where the adapter ends up.
    const failure = await tools.run('bluetoothctl', ['power', on ? 'on' : 'off'], QUICK_MS).then(() => null, (error: Error) => error);
    if (!on) {
        await tools.run(RFKILL, ['block', 'bluetooth'], QUICK_MS).catch(() => undefined);
    }
    for (let second = 0; second < POWER_SECONDS; second++) {
        if (await isPowered(tools) === on) {
            return;
        }
        await tools.sleep(POLL_MS);
    }
    throw failure ?? new Error('The adapter did not follow.');
}

/**
 * Searches for `seconds` and gives what answered with a name and is not paired yet, gamepads
 * first. The device must be in its pairing mode meanwhile.
 */
export async function scanBluetooth(seconds: number = SCAN_SECONDS, tools: BluetoothTools = systemTools): Promise<BluetoothDevice[]> {
    const session = tools.open();
    try {
        session.send('scan on');
        await tools.sleep(seconds * 1000);
        const devices = await readDevices([], tools);
        return devices
            .filter(device => device.name && !device.paired)
            .sort((a, b) => Number(b.gamepad) - Number(a.gamepad) || a.name.localeCompare(b.name));
    } finally {
        session.send('scan off');
        session.close();
    }
}

async function waitFor(
    address: string, seconds: number, tools: BluetoothTools, reached: (device: BluetoothDevice | null) => boolean,
    meanwhile?: () => void,
): Promise<boolean> {
    for (let second = 0; second < seconds; second++) {
        if (reached(await readDevice(address, tools))) {
            return true;
        }
        meanwhile?.();
        await tools.sleep(POLL_MS);
    }
    return reached(await readDevice(address, tools));
}

/**
 * Pairs the device, in its pairing mode, and resolves to it. Trusted first, so that it reconnects
 * on its own each time it is switched on without BlueZ asking anyone. A pad that pairs but does
 * not connect right away is still a success: it connects at its next key press.
 */
export async function pairBluetooth(address: string, tools: BluetoothTools = systemTools): Promise<BluetoothDevice> {
    if (!ADDRESS_PATTERN.test(address)) {
        throw new Error('Not a Bluetooth address.');
    }
    const session = tools.open();
    try {
        session.send('scan on');
        if (!await waitFor(address, FIND_SECONDS, tools, device => device !== null)) {
            throw new Error('The device no longer answers: put it back in its pairing mode.');
        }
        session.send(`trust ${address}`);
        session.send(`pair ${address}`);
        // A device that asks for a confirmation all the same gets it: nobody stands at the cabinet.
        if (!await waitFor(address, PAIR_SECONDS, tools, device => device?.paired === true, () => session.send('yes'))) {
            throw new Error('The device did not accept: put it back in its pairing mode and try again.');
        }
        session.send(`connect ${address}`);
        await waitFor(address, CONNECT_SECONDS, tools, device => device?.connected === true);
        const device = await readDevice(address, tools);
        if (!device) {
            throw new Error('The device disappeared right after pairing.');
        }
        return device;
    } finally {
        session.send('scan off');
        session.close();
    }
}

/** Forgets a paired device. */
export async function removeBluetooth(address: string, tools: BluetoothTools = systemTools): Promise<void> {
    if (!ADDRESS_PATTERN.test(address)) {
        throw new Error('Not a Bluetooth address.');
    }
    await tools.run('bluetoothctl', ['remove', address], QUICK_MS);
}
