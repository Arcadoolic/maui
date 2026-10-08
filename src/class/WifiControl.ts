import {execFile} from 'child_process';
import os from 'os';

// The Wi-Fi of a dedicated cabinet, driven from the BO through NetworkManager's nmcli: without it
// the only way to join a network is a keyboard or SSH. No sudo: the application runs in the
// kiosk's own session on tty1, local and active, which polkit lets switch the radio, scan and
// connect; Debian's NetworkManager rule adds the system connections for the netdev group
// (checked with pkcheck on the Raspberry Pi cabinet, 2026-10-08). The same commands are refused
// over SSH. Electron-free.

const QUICK_MS = 10000;
const SCAN_MS = 20000;
// nmcli gives up on its own after CONNECT_WAIT_S; the process timeout is only a safety net.
const CONNECT_WAIT_S = 30;
const CONNECT_MS = 40000;

const WIFI_TYPE = '802-11-wireless';
const UUID_PATTERN = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

/** Runs nmcli with these arguments and resolves to its output; rejects with a message fit for the BO. */
export type Nmcli = (args: string[], timeoutMs: number) => Promise<string>;

/**
 * What to tell the BO's user about a failed nmcli. Never the error's own message: Node puts the
 * whole command line in it, Wi-Fi password included.
 */
export function describeNmcliFailure(stderr: string, error: {code?: unknown; killed?: boolean}): string {
    const line = stderr.split('\n').map(text => text.trim()).find(text => text.length > 0);
    if (line) {
        return line.replace(/^Error: /, '');
    }
    if (error.code === 'ENOENT') {
        return 'nmcli is not installed.';
    }
    return error.killed ? 'NetworkManager did not answer in time.' : 'NetworkManager refused the request.';
}

// LC_ALL=C: the states ("connected", "enabled") are translated otherwise.
const runNmcli: Nmcli = (args, timeoutMs) => new Promise((resolve, reject) => {
    execFile(
        'nmcli', args, {encoding: 'utf8', timeout: timeoutMs, env: {...process.env, LC_ALL: 'C'}},
        (error, stdout, stderr) => {
            if (error) {
                reject(new Error(describeNmcliFailure(stderr, error)));
            } else {
                resolve(stdout);
            }
        },
    );
});

/** The fields of a line of `nmcli -t`: separated by colons, a colon or backslash of a value escaped. */
export function splitTerse(line: string): string[] {
    const fields: string[] = [];
    let field = '';
    for (let index = 0; index < line.length; index++) {
        const char = line[index];
        if (char === '\\' && index + 1 < line.length) {
            field += line[++index];
        } else if (char === ':') {
            fields.push(field);
            field = '';
        } else {
            field += char;
        }
    }
    fields.push(field);
    return fields;
}

function terseLines(text: string): string[][] {
    return text.split('\n').filter(line => line.length > 0).map(splitTerse);
}

export interface NetworkLink {
    device: string;
    type: 'ethernet' | 'wifi';
    connected: boolean;
    // The profile in use, empty when there is none.
    connection: string;
    // IPv4 address, null without one.
    address: string | null;
}

export interface WifiNetwork {
    ssid: string;
    // 0 to 100.
    signal: number;
    // "WPA2", "WPA2 WPA3"..., empty for an open network.
    security: string;
    inUse: boolean;
}

export interface SavedWifi {
    uuid: string;
    name: string;
    ssid: string;
    active: boolean;
}

export interface NetworkState {
    // "missing": no Wi-Fi adapter. "blocked": switched off by hardware, nothing to do from here.
    wifi: 'missing' | 'blocked' | 'off' | 'on';
    links: NetworkLink[];
    // In range, strongest first, one line per name. Empty while the radio is off.
    networks: WifiNetwork[];
    saved: SavedWifi[];
}

type Interfaces = ReturnType<typeof os.networkInterfaces>;

export function parseLinks(text: string, interfaces: Interfaces): NetworkLink[] {
    const links: NetworkLink[] = [];
    for (const [device, type, state, connection] of terseLines(text)) {
        if (type !== 'ethernet' && type !== 'wifi') {
            continue;
        }
        links.push({
            device,
            type,
            // "connected", not "connecting (getting IP configuration)" nor "disconnected".
            connected: state === 'connected' || state.startsWith('connected '),
            connection: connection ?? '',
            address: interfaces[device]?.find(address => address.family === 'IPv4')?.address ?? null,
        });
    }
    return links;
}

/** `nmcli -t -f WIFI-HW,WIFI radio`. */
export function parseRadio(text: string): NetworkState['wifi'] {
    const [hardware, software] = terseLines(text)[0] ?? [];
    if (hardware === 'missing' || hardware === undefined) {
        return 'missing';
    }
    if (hardware !== 'enabled') {
        return 'blocked';
    }
    return software === 'enabled' ? 'on' : 'off';
}

/** An access point per line in, a network per name out: hidden ones (no name) are left out. */
export function parseWifiList(text: string): WifiNetwork[] {
    const networks = new Map<string, WifiNetwork>();
    for (const [inUse, ssid, signal, security] of terseLines(text)) {
        if (!ssid) {
            continue;
        }
        const found: WifiNetwork = {
            ssid,
            signal: Number(signal) || 0,
            security: !security || security === '--' ? '' : security,
            inUse: inUse === '*',
        };
        const known = networks.get(ssid);
        if (!known) {
            networks.set(ssid, found);
        } else {
            networks.set(ssid, {...(found.signal > known.signal ? found : known), inUse: known.inUse || found.inUse});
        }
    }
    return [...networks.values()].sort((a, b) => Number(b.inUse) - Number(a.inUse) || b.signal - a.signal);
}

async function readSavedWifi(nmcli: Nmcli): Promise<SavedWifi[]> {
    const profiles = terseLines(await nmcli(['-t', '-f', 'NAME,UUID,TYPE,DEVICE', 'connection', 'show'], QUICK_MS))
        .filter(([, uuid, type]) => type === WIFI_TYPE && UUID_PATTERN.test(uuid ?? ''));
    if (!profiles.length) {
        return [];
    }
    // A profile's name is the network's by default, not by rule: its SSID is read apart, all the
    // profiles in one call (blocks of "connection.uuid:" / "802-11-wireless.ssid:" lines).
    const details = await nmcli(
        ['-t', '-f', 'connection.uuid,802-11-wireless.ssid', 'connection', 'show', ...profiles.flatMap(([, uuid]) => ['uuid', uuid])],
        QUICK_MS,
    );
    const ssids = new Map<string, string>();
    let current = '';
    for (const [key, value] of terseLines(details)) {
        if (key === 'connection.uuid') {
            current = value ?? '';
        } else if (key === '802-11-wireless.ssid') {
            ssids.set(current, value ?? '');
        }
    }
    return profiles.map(([name, uuid, , device]) => ({uuid, name, ssid: ssids.get(uuid) || name, active: !!device}));
}

/**
 * Everything the BO's Network card shows, null when NetworkManager is not there to ask (not
 * installed, not running). `rescan` waits for a fresh look at the networks in range (seconds);
 * without it NetworkManager answers with what it last saw.
 */
export async function readNetworkState(
    rescan: boolean = false, nmcli: Nmcli = runNmcli, interfaces: Interfaces = os.networkInterfaces(),
): Promise<NetworkState | null> {
    try {
        const [radio, devices, saved] = await Promise.all([
            nmcli(['-t', '-f', 'WIFI-HW,WIFI', 'radio'], QUICK_MS),
            nmcli(['-t', '-f', 'DEVICE,TYPE,STATE,CONNECTION', 'device', 'status'], QUICK_MS),
            readSavedWifi(nmcli),
        ]);
        const wifi = parseRadio(radio);
        let networks: WifiNetwork[] = [];
        if (wifi === 'on') {
            const list = (mode: 'yes' | 'no'): Promise<string> => nmcli(
                ['-t', '-f', 'IN-USE,SSID,SIGNAL,SECURITY', 'device', 'wifi', 'list', '--rescan', mode], SCAN_MS,
            );
            // A radio just switched on refuses to scan for a moment: what it has is shown instead.
            networks = parseWifiList(await (rescan ? list('yes').catch(() => list('no')) : list('no')).catch(() => ''));
        }
        return {wifi, links: parseLinks(devices, interfaces), networks, saved};
    } catch {
        return null;
    }
}

/**
 * Whether the Wi-Fi is all that connects this machine: switching it off or forgetting its network
 * would then leave a cabinet nobody can reach, the BO included.
 */
export function isWifiTheOnlyLink(state: NetworkState): boolean {
    return state.links.some(link => link.type === 'wifi' && link.connected)
        && !state.links.some(link => link.type === 'ethernet' && link.connected);
}

export async function setWifiRadio(on: boolean, nmcli: Nmcli = runNmcli): Promise<void> {
    await nmcli(['radio', 'wifi', on ? 'on' : 'off'], QUICK_MS);
}

/** Null when the name and password can be handed to NetworkManager, the reason otherwise. */
export function checkWifiCredentials(ssid: string, password: string): string | null {
    if (!ssid || Buffer.byteLength(ssid, 'utf8') > 32) {
        return 'A network name is 1 to 32 bytes long.';
    }
    if (password && (password.length < 8 || password.length > 64)) {
        return 'A Wi-Fi password is 8 to 63 characters long.';
    }
    return null;
}

/**
 * Joins `ssid`, with `password` when it has one and is not saved yet. On a failure the cabinet is
 * put back as it was: the profile this attempt created is removed (NetworkManager would keep
 * retrying a wrong password) and the network it was on is joined again. Rejects with the reason.
 */
export async function connectWifi(ssid: string, password: string, nmcli: Nmcli = runNmcli): Promise<void> {
    const invalid = checkWifiCredentials(ssid, password);
    if (invalid) {
        throw new Error(invalid);
    }
    const before = await readSavedWifi(nmcli);
    const known = before.find(profile => profile.ssid === ssid);
    const previous = before.find(profile => profile.active);
    const wait = ['--wait', String(CONNECT_WAIT_S)];
    try {
        if (known) {
            if (password) {
                await nmcli(['connection', 'modify', 'uuid', known.uuid, 'wifi-sec.psk', password], QUICK_MS);
            }
            await nmcli([...wait, 'connection', 'up', 'uuid', known.uuid], CONNECT_MS);
        } else {
            await nmcli([...wait, 'device', 'wifi', 'connect', ssid, ...(password ? ['password', password] : [])], CONNECT_MS);
        }
    } catch (error) {
        const after = await readSavedWifi(nmcli).catch(() => [] as SavedWifi[]);
        for (const profile of after.filter(candidate => !before.some(old => old.uuid === candidate.uuid))) {
            await nmcli(['connection', 'delete', 'uuid', profile.uuid], QUICK_MS).catch(() => undefined);
        }
        if (previous && previous.uuid !== known?.uuid) {
            await nmcli([...wait, 'connection', 'up', 'uuid', previous.uuid], CONNECT_MS).catch(() => undefined);
        }
        throw error;
    }
}

/** Removes a saved Wi-Fi network, and only that: any other profile's uuid is refused. */
export async function forgetWifi(uuid: string, nmcli: Nmcli = runNmcli): Promise<void> {
    const saved = await readSavedWifi(nmcli);
    if (!saved.some(profile => profile.uuid === uuid)) {
        throw new Error('This network is not saved on the cabinet.');
    }
    await nmcli(['connection', 'delete', 'uuid', uuid], QUICK_MS);
}
