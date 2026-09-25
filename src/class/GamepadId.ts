/**
 * USB vendor/product IDs recovered from the device id MAME reports for a joystick (the Lua
 * `input_device.id` dumped by device-probe.lua). The id's format depends on MAME's joystick
 * provider, i.e. on the platform:
 * - SDL (Linux, macOS default): SDL's 32-hex-digit joystick GUID, optionally followed by a serial
 *   number. Little-endian 16-bit fields: bus type at byte 0, vendor at byte 4, product at byte 8,
 *   with bytes 6-7 and 10-11 zero - otherwise SDL filled the GUID with the device name instead
 *   (no usable IDs).
 * - DirectInput (Windows): holds the device's product GUID, "{PPPPVVVV-0000-0000-0000-504944564944}"
 *   (the last group is "PIDVID" in ASCII) for USB HID devices.
 * - XInput (Windows) ids like "XInput Player 1" carry no IDs at all.
 */

export interface GamepadIds {
    // Lower-case 4-digit hex, as `lsusb` and most device databases print them.
    vendorId: string;
    productId: string;
    // Known manufacturer for vendorId, if any (see KNOWN_VENDORS).
    vendorName?: string;
    // Only known for SDL GUIDs.
    bus?: string;
}

/**
 * A few manufacturers commonly found on arcade cabinets (encoders) and console-style pads - not
 * meant to be exhaustive, the raw vendor ID is always shown alongside.
 */
const KNOWN_VENDORS: Record<string, string> = {
    '0079': 'DragonRise',
    '044f': 'Thrustmaster',
    '045e': 'Microsoft',
    '046d': 'Logitech',
    '054c': 'Sony',
    '057e': 'Nintendo',
    '0738': 'Mad Catz',
    '0810': 'Personal Communication Systems',
    '0e6f': 'PDP',
    '0f0d': 'Hori',
    '20d6': 'PowerA',
    '2563': 'ShanWan',
    '28de': 'Valve',
    '2dc8': '8BitDo',
    'd209': 'Ultimarc',
};

const SDL_BUSES: Record<number, string> = {
    0x03: 'USB',
    0x05: 'Bluetooth',
    0xff: 'Virtual',
};

function withVendorName(ids: GamepadIds): GamepadIds {
    const vendorName = KNOWN_VENDORS[ids.vendorId];
    return vendorName ? {...ids, vendorName} : ids;
}

function hex4(value: number): string {
    return value.toString(16).padStart(4, '0');
}

/**
 * Returns the vendor/product IDs encoded in `deviceId`, or null when its format carries none (see
 * the header comment for the formats understood).
 */
export function parseGamepadIds(deviceId: string): GamepadIds | null {
    const sdl = /^([0-9a-f]{32})(?![0-9a-f])/i.exec(deviceId.trim());
    if (sdl) {
        const bytes = sdl[1].match(/../g)!.map(pair => parseInt(pair, 16));
        const le16 = (offset: number) => bytes[offset] | (bytes[offset + 1] << 8);
        const vendor = le16(4);
        if (vendor && !le16(6) && !le16(10)) {
            const bus = SDL_BUSES[le16(0)];
            return withVendorName({
                vendorId: hex4(vendor),
                productId: hex4(le16(8)),
                ...(bus ? {bus} : {}),
            });
        }
        return null;
    }
    const dinput = /([0-9a-f]{4})([0-9a-f]{4})-0000-0000-0000-504944564944/i.exec(deviceId);
    if (dinput) {
        return withVendorName({vendorId: dinput[2].toLowerCase(), productId: dinput[1].toLowerCase()});
    }
    return null;
}
