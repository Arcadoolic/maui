import {describe, it, expect} from 'vitest';
import {isWirelessInterface, pickLocalAddress, type NetworkInterfaces} from '@/class/LocalAddress';

const ipv4 = (address: string, internal = false) => ({address, family: 'IPv4', internal});
const ipv6 = (address: string) => ({address, family: 'IPv6', internal: false});

describe('pickLocalAddress', () => {
    const wireless = (name: string) => name.startsWith('wl');

    it('gives the wired address when there is no Wi-Fi', () => {
        const interfaces: NetworkInterfaces = {lo: [ipv4('127.0.0.1', true)], eth0: [ipv6('fe80::1'), ipv4('192.168.1.20')]};
        expect(pickLocalAddress(interfaces, wireless)).toBe('192.168.1.20');
    });

    it('gives the Wi-Fi address first when there are both', () => {
        const interfaces: NetworkInterfaces = {eth0: [ipv4('192.168.1.20')], wlan0: [ipv4('192.168.1.42')]};
        expect(pickLocalAddress(interfaces, wireless)).toBe('192.168.1.42');
    });

    it('leaves out containers, VPNs and self-assigned addresses', () => {
        const interfaces: NetworkInterfaces = {
            docker0: [ipv4('172.17.0.1')], tun0: [ipv4('10.8.0.2')], eth0: [ipv4('169.254.10.3')], end0: [ipv4('192.168.1.7')],
        };
        expect(pickLocalAddress(interfaces, wireless)).toBe('192.168.1.7');
    });

    it('accepts the numeric family some Node versions give', () => {
        expect(pickLocalAddress({eth0: [{address: '10.0.0.5', family: 4, internal: false}]}, wireless)).toBe('10.0.0.5');
    });

    it('gives nothing without a local network', () => {
        expect(pickLocalAddress({lo: [ipv4('127.0.0.1', true)]}, wireless)).toBeNull();
        expect(pickLocalAddress({}, wireless)).toBeNull();
    });
});

describe('isWirelessInterface', () => {
    it('knows a Linux Wi-Fi by its name or by the kernel', () => {
        expect(isWirelessInterface('wlan0', 'linux', () => false)).toBe(true);
        expect(isWirelessInterface('wlp2s0', 'linux', () => false)).toBe(true);
        expect(isWirelessInterface('eth0', 'linux', () => false)).toBe(false);
        expect(isWirelessInterface('mlan0', 'linux', path => path === '/sys/class/net/mlan0/wireless')).toBe(true);
    });

    it('knows a Windows Wi-Fi by its name', () => {
        expect(isWirelessInterface('Wi-Fi', 'win32')).toBe(true);
        expect(isWirelessInterface('Ethernet', 'win32')).toBe(false);
    });

    it('never takes a macOS interface for a Wi-Fi one', () => {
        expect(isWirelessInterface('en0', 'darwin')).toBe(false);
    });
});
