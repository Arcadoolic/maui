import {existsSync} from 'fs';

// The machine's address on the local network, shown for a few seconds in the front's ONLINE
// badge (OnlineBadge.vue): what to type to reach the cabinet over SSH or its BO from a phone.
// With both a Wi-Fi and a wired link, the Wi-Fi's address is the one shown.

export interface InterfaceAddress {
    address: string;
    family: string | number;
    internal: boolean;
}

export type NetworkInterfaces = Record<string, InterfaceAddress[] | undefined>;

// Links that are not the machine's own on the local network: containers, virtual machines, VPNs.
const VIRTUAL_INTERFACE = /^(docker|br-|veth|virbr|vboxnet|vmnet|tun|tap|utun|wg|zt|lo)/i;

/**
 * Whether an interface is a Wi-Fi one. Linux: the kernel gives it a `wireless` directory (named
 * wlan0, wlp2s0... too). Windows: its name says so ("Wi-Fi"). macOS names do not tell (en0 is the
 * Wi-Fi of a laptop, the Ethernet of a desktop): never taken for one there.
 */
export function isWirelessInterface(
    name: string, platform: string = process.platform, exists: (path: string) => boolean = existsSync,
): boolean {
    if (platform === 'linux') {
        return /^wl/.test(name) || exists(`/sys/class/net/${name}/wireless`);
    }
    if (platform === 'win32') {
        return /wi-?fi|wireless|wlan/i.test(name);
    }
    return false;
}

/** The IPv4 address to show, the Wi-Fi's first; null without any local network. */
export function pickLocalAddress(
    interfaces: NetworkInterfaces, isWireless: (name: string) => boolean = isWirelessInterface,
): string | null {
    let wired: string | null = null;
    for (const [name, addresses] of Object.entries(interfaces)) {
        if (VIRTUAL_INTERFACE.test(name)) {
            continue;
        }
        // Node gives the family as 4 instead of 'IPv4' in some versions.
        const found = addresses?.find(address => (address.family === 'IPv4' || address.family === 4)
            && !address.internal && !address.address.startsWith('169.254.'));
        if (!found) {
            continue;
        }
        if (isWireless(name)) {
            return found.address;
        }
        wired ??= found.address;
    }
    return wired;
}
