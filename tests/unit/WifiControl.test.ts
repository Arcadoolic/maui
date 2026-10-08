import {describe, it, expect} from 'vitest';
import {
    checkWifiCredentials, connectWifi, describeNmcliFailure, forgetWifi, isWifiTheOnlyLink, parseLinks, parseRadio,
    parseWifiList, readNetworkState, splitTerse, type NetworkState, type Nmcli,
} from '@/class/WifiControl';

// The Raspberry Pi cabinet (2026-10-08, nmcli 1.52.1): on its cable, Wi-Fi radio off.
const PI_DEVICES = `eth0:ethernet:connected:Wired connection 1
lo:loopback:connected (externally):lo
wlan0:wifi:unavailable:
`;
const PI_RADIO = 'enabled:disabled\n';

const HOME_UUID = 'fc49dc23-4fe6-4de4-afe0-06c305e6db03';
const CAFE_UUID = '0a1b2c3d-1111-2222-3333-444455556666';
const WIRED_UUID = '9f35fa16-d800-3b1e-bfa5-041d803ca8bc';

const INTERFACES = {
    eth0: [{address: 'fe80::1', family: 'IPv6'}, {address: '192.168.1.48', family: 'IPv4'}],
    wlan0: [{address: '192.168.1.77', family: 'IPv4'}],
} as unknown as NodeJS.Dict<import('os').NetworkInterfaceInfo[]>;

interface FakeOptions {
    // uuid -> [name, ssid, device]
    profiles?: Record<string, [string, string, string]>;
    fail?: (args: string[]) => string | undefined;
    onConnect?: (profiles: Record<string, [string, string, string]>) => void;
}

/** An nmcli that keeps saved Wi-Fi profiles and records what it was asked. */
function fakeNmcli(options: FakeOptions = {}): {nmcli: Nmcli; calls: string[][]; profiles: Record<string, [string, string, string]>} {
    const profiles = {...options.profiles};
    const calls: string[][] = [];
    const nmcli: Nmcli = async args => {
        calls.push(args);
        if (args.includes('wifi') && args.includes('connect')) {
            options.onConnect?.(profiles);
        }
        const failure = options.fail?.(args);
        if (failure) {
            throw new Error(failure);
        }
        if (args.includes('NAME,UUID,TYPE,DEVICE')) {
            return `Wired connection 1:${WIRED_UUID}:802-3-ethernet:eth0\n`
                + Object.entries(profiles).map(([uuid, [name, , device]]) => `${name}:${uuid}:802-11-wireless:${device}\n`).join('');
        }
        if (args.includes('connection.uuid,802-11-wireless.ssid')) {
            return Object.entries(profiles)
                .filter(([uuid]) => args.includes(uuid))
                .map(([uuid, [, ssid]]) => `connection.uuid:${uuid}\n802-11-wireless.ssid:${ssid}\n`).join('\n');
        }
        if (args[0] === 'connection' && args[1] === 'delete') {
            delete profiles[args[3]];
        }
        return '';
    };
    return {nmcli, calls, profiles};
}

describe('splitTerse', () => {
    it('splits on colons and unescapes those of a value', () => {
        expect(splitTerse('wlan0:wifi:unavailable:')).toEqual(['wlan0', 'wifi', 'unavailable', '']);
        expect(splitTerse(' :Bar\\: le 12:54:WPA2')).toEqual([' ', 'Bar: le 12', '54', 'WPA2']);
        expect(splitTerse('a\\\\b:c')).toEqual(['a\\b', 'c']);
    });
});

describe('parseRadio', () => {
    it('tells an adapter that is off from one that is missing or blocked', () => {
        expect(parseRadio(PI_RADIO)).toBe('off');
        expect(parseRadio('enabled:enabled\n')).toBe('on');
        expect(parseRadio('missing:enabled\n')).toBe('missing');
        expect(parseRadio('disabled:enabled\n')).toBe('blocked');
        expect(parseRadio('')).toBe('missing');
    });
});

describe('parseLinks', () => {
    it('keeps the cable and the Wi-Fi, with their IPv4 address', () => {
        expect(parseLinks(PI_DEVICES, INTERFACES)).toEqual([
            {device: 'eth0', type: 'ethernet', connected: true, connection: 'Wired connection 1', address: '192.168.1.48'},
            {device: 'wlan0', type: 'wifi', connected: false, connection: '', address: '192.168.1.77'},
        ]);
    });

    it('does not take a link that is still connecting for a connected one', () => {
        const [link] = parseLinks('wlan0:wifi:connecting (getting IP configuration):Home\n', {});
        expect(link.connected).toBe(false);
        expect(link.address).toBeNull();
    });
});

describe('parseWifiList', () => {
    it('gives one line per name, the one in use first then the strongest, without the hidden ones', () => {
        const list = ' :Home:40:WPA2\n*:Home:71:WPA2\n :Cafe\\: free:88:\n ::90:WPA2\n :Neighbour:55:WPA2 WPA3\n :Old:20:--\n';
        expect(parseWifiList(list)).toEqual([
            {ssid: 'Home', signal: 71, security: 'WPA2', inUse: true},
            {ssid: 'Cafe: free', signal: 88, security: '', inUse: false},
            {ssid: 'Neighbour', signal: 55, security: 'WPA2 WPA3', inUse: false},
            {ssid: 'Old', signal: 20, security: '', inUse: false},
        ]);
    });
});

describe('describeNmcliFailure', () => {
    it('gives nmcli\'s own reason, never the command line', () => {
        expect(describeNmcliFailure('Error: Connection activation failed: (7) Secrets were required, but not provided.\n', {}))
            .toBe('Connection activation failed: (7) Secrets were required, but not provided.');
        expect(describeNmcliFailure('', {code: 'ENOENT'})).toBe('nmcli is not installed.');
        expect(describeNmcliFailure('', {killed: true})).toBe('NetworkManager did not answer in time.');
    });
});

describe('readNetworkState', () => {
    it('reads the cabinet on its cable with the radio off, without asking for the networks in range', async () => {
        const {nmcli, calls} = fakeNmcli({
            profiles: {[HOME_UUID]: ['Home 1', 'Home', '']},
        });
        const answering: Nmcli = async (args, timeout) => {
            if (args.includes('radio')) {
                return PI_RADIO;
            }
            return args.includes('status') ? PI_DEVICES : nmcli(args, timeout);
        };

        const state = await readNetworkState(false, answering, INTERFACES);

        expect(state?.wifi).toBe('off');
        expect(state?.links).toHaveLength(2);
        expect(state?.networks).toEqual([]);
        // The SSID, not the profile's name.
        expect(state?.saved).toEqual([{uuid: HOME_UUID, name: 'Home 1', ssid: 'Home', active: false}]);
        expect(calls.some(args => args.includes('list'))).toBe(false);
    });

    it('falls back on what NetworkManager last saw when the scan is refused', async () => {
        const asked: string[] = [];
        const nmcli: Nmcli = async args => {
            if (args.includes('radio')) {
                return 'enabled:enabled\n';
            }
            if (args.includes('list')) {
                asked.push(args[args.length - 1]);
                if (args[args.length - 1] === 'yes') {
                    throw new Error('Scanning not allowed immediately following previous scan.');
                }
                return ' :Home:60:WPA2\n';
            }
            return '';
        };

        const state = await readNetworkState(true, nmcli, {});

        expect(asked).toEqual(['yes', 'no']);
        expect(state?.networks.map(network => network.ssid)).toEqual(['Home']);
    });

    it('is null without NetworkManager', async () => {
        expect(await readNetworkState(false, async () => { throw new Error('nmcli is not installed.'); }, {})).toBeNull();
    });
});

describe('isWifiTheOnlyLink', () => {
    const state = (ethernet: boolean, wifi: boolean): NetworkState => ({
        wifi: 'on', networks: [], saved: [],
        links: [
            {device: 'eth0', type: 'ethernet', connected: ethernet, connection: '', address: null},
            {device: 'wlan0', type: 'wifi', connected: wifi, connection: '', address: null},
        ],
    });

    it('is true only on the Wi-Fi without a cable', () => {
        expect(isWifiTheOnlyLink(state(false, true))).toBe(true);
        expect(isWifiTheOnlyLink(state(true, true))).toBe(false);
        expect(isWifiTheOnlyLink(state(true, false))).toBe(false);
        expect(isWifiTheOnlyLink(state(false, false))).toBe(false);
    });
});

describe('checkWifiCredentials', () => {
    it('refuses what NetworkManager would refuse', () => {
        expect(checkWifiCredentials('Home', 'correct horse')).toBeNull();
        expect(checkWifiCredentials('Open network', '')).toBeNull();
        expect(checkWifiCredentials('', 'correct horse')).not.toBeNull();
        expect(checkWifiCredentials('é'.repeat(17), '')).not.toBeNull();
        expect(checkWifiCredentials('Home', 'short')).not.toBeNull();
    });
});

describe('connectWifi', () => {
    it('joins a new network with its password', async () => {
        const {nmcli, calls} = fakeNmcli();

        await connectWifi('Home', 'correct horse', nmcli);

        expect(calls[calls.length - 1]).toEqual(['--wait', '30', 'device', 'wifi', 'connect', 'Home', 'password', 'correct horse']);
    });

    it('brings a saved network up without asking for its password again', async () => {
        const {nmcli, calls} = fakeNmcli({profiles: {[HOME_UUID]: ['Home', 'Home', '']}});

        await connectWifi('Home', '', nmcli);

        expect(calls[calls.length - 1]).toEqual(['--wait', '30', 'connection', 'up', 'uuid', HOME_UUID]);
        expect(calls.some(args => args.includes('connect'))).toBe(false);
    });

    it('removes the profile of a failed attempt and goes back to the network in use', async () => {
        const {nmcli, calls, profiles} = fakeNmcli({
            profiles: {[CAFE_UUID]: ['Cafe', 'Cafe', 'wlan0']},
            onConnect: saved => { saved[HOME_UUID] = ['Home', 'Home', '']; },
            fail: args => args.includes('connect') ? 'Secrets were required, but not provided.' : undefined,
        });

        await expect(connectWifi('Home', 'wrong password', nmcli)).rejects.toThrow('Secrets were required');

        expect(Object.keys(profiles)).toEqual([CAFE_UUID]);
        expect(calls[calls.length - 1]).toEqual(['--wait', '30', 'connection', 'up', 'uuid', CAFE_UUID]);
    });

    it('asks NetworkManager nothing for a password it would refuse', async () => {
        const {nmcli, calls} = fakeNmcli();

        await expect(connectWifi('Home', 'short', nmcli)).rejects.toThrow('8 to 63');
        expect(calls).toEqual([]);
    });
});

describe('forgetWifi', () => {
    it('deletes a saved Wi-Fi network', async () => {
        const {nmcli, profiles} = fakeNmcli({profiles: {[HOME_UUID]: ['Home', 'Home', '']}});

        await forgetWifi(HOME_UUID, nmcli);

        expect(profiles).toEqual({});
    });

    it('refuses any other profile, the cable\'s included', async () => {
        const {nmcli, calls} = fakeNmcli({profiles: {[HOME_UUID]: ['Home', 'Home', '']}});

        await expect(forgetWifi(WIRED_UUID, nmcli)).rejects.toThrow('not saved');
        expect(calls.some(args => args.includes('delete'))).toBe(false);
    });
});
