import {describe, it, expect} from 'vitest';
import {renderNetworkCard} from '@/class/NetworkBoCard';
import type {NetworkState} from '@/class/WifiControl';

const HOME_UUID = 'fc49dc23-4fe6-4de4-afe0-06c305e6db03';

function state(overrides: Partial<NetworkState> = {}): NetworkState {
    return {
        wifi: 'on',
        links: [
            {device: 'eth0', type: 'ethernet', connected: true, connection: 'Wired connection 1', address: '192.168.1.48'},
            {device: 'wlan0', type: 'wifi', connected: false, connection: '', address: null},
        ],
        networks: [],
        saved: [],
        ...overrides,
    };
}

const ON_WIFI_ALONE: NetworkState['links'] = [
    {device: 'eth0', type: 'ethernet', connected: false, connection: '', address: null},
    {device: 'wlan0', type: 'wifi', connected: true, connection: 'Home', address: '192.168.1.77'},
];

describe('renderNetworkCard', () => {
    it('shows each link with its address', () => {
        const html = renderNetworkCard(state());
        expect(html).toContain('Ethernet (<code>eth0</code>)');
        expect(html).toContain('<code>192.168.1.48</code>');
        expect(html).toContain('Not connected');
    });

    it('only offers to switch the radio on while it is off', () => {
        const html = renderNetworkCard(state({wifi: 'off'}));
        expect(html).toContain('Turn Wi-Fi on');
        expect(html).not.toContain('Networks in range');
    });

    it('offers nothing without an adapter', () => {
        const html = renderNetworkCard(state({wifi: 'missing'}));
        expect(html).toContain('no Wi-Fi adapter');
        expect(html).not.toContain('<form');
    });

    it('asks for a password only for a secured network that is not saved', () => {
        const html = renderNetworkCard(state({
            networks: [
                {ssid: 'Home', signal: 71, security: 'WPA2', inUse: false},
                {ssid: 'Neighbour', signal: 55, security: 'WPA2', inUse: false},
                {ssid: 'Cafe', signal: 40, security: '', inUse: false},
            ],
            saved: [{uuid: HOME_UUID, name: 'Home', ssid: 'Home', active: false}],
        }));
        expect(html.match(/type="password"/g)).toHaveLength(1);
        expect(html).toContain('aria-label="Password for Neighbour"');
        expect(html.match(/action="\/maui\/network\/connect"/g)).toHaveLength(3);
    });

    it('escapes a network\'s name', () => {
        const html = renderNetworkCard(state({networks: [{ssid: '"><script>', signal: 10, security: '', inUse: false}]}));
        expect(html).not.toContain('<script>');
        expect(html).toContain('value="&quot;&gt;&lt;script&gt;"');
    });

    it('neither switches the Wi-Fi off nor forgets its network when it is the only link', () => {
        const saved = [{uuid: HOME_UUID, name: 'Home', ssid: 'Home', active: true}];
        const alone = renderNetworkCard(state({links: ON_WIFI_ALONE, saved}));
        expect(alone).toContain('plug in a network cable first');
        expect(alone).not.toContain('action="/maui/network/radio"');
        expect(alone).not.toContain('action="/maui/network/forget"');

        const withCable = renderNetworkCard(state({saved}));
        expect(withCable).toContain('action="/maui/network/radio"');
        expect(withCable).toContain('action="/maui/network/forget"');
    });
});
