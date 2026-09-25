/**
 * `<mapdevice>` entries of a MAME controller file (<ctrlrpath>/<ctrlr>.cfg, loaded through
 * mame.ini's `ctrlr` option): each pins a joystick, matched by its device id, to a fixed
 * `JOYCODE_<n>` number instead of the enumeration order MAME would otherwise give it (which
 * changes with plug/pairing order). MAME only honors `<mapdevice>` in a controller file, not in
 * default.cfg. Electron-free like MameCfg.ts, so it stays unit-testable.
 *
 * Hand-rolled edit of the `<input>` block, not a general XML parser: everything else in the file
 * (e.g. `<port>` entries of a hand-written controller file) is preserved verbatim. MAME never
 * writes controller files itself.
 */

const EMPTY_CTRLR_CFG = `<?xml version="1.0"?>
<mameconfig version="10">
    <system name="default">
    </system>
</mameconfig>
`;

const MAPDEVICE_REGEX = /<mapdevice\s+device="([^"]*)"\s+controller="([^"]*)"\s*\/>/g;

function escapeXmlAttribute(value: string): string {
    return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

function unescapeXmlAttribute(value: string): string {
    return value.replace(/&lt;/g, '<').replace(/&quot;/g, '"').replace(/&amp;/g, '&');
}

/** Device id pinned to each controller (`JOYCODE_<n>`), in file order. */
export function readCtrlrMapDevices(xml: string): Map<string, string> {
    const mapped = new Map<string, string>();
    for (const match of xml.matchAll(MAPDEVICE_REGEX)) {
        mapped.set(match[2], unescapeXmlAttribute(match[1]));
    }
    return mapped;
}

/**
 * Pins `deviceId` to `controller` (e.g. "JOYCODE_1"), or unpins it when `controller` is null.
 * A device holds at most one controller and a controller at most one device, so any previous
 * entry for either is replaced. `xml` undefined means the file doesn't exist yet.
 */
export function setCtrlrMapDevice(xml: string | undefined, deviceId: string, controller: string | null): string {
    const existing = xml ?? EMPTY_CTRLR_CFG;
    const mapped = readCtrlrMapDevices(existing);
    for (const [otherController, otherDevice] of mapped) {
        if (otherDevice === deviceId || otherController === controller) {
            mapped.delete(otherController);
        }
    }
    if (controller) {
        mapped.set(controller, deviceId);
    }
    const entries = Array.from(mapped.entries())
        .sort(([a], [b]) => a.localeCompare(b, undefined, {numeric: true}))
        .map(([ctrl, device]) => `            <mapdevice device="${escapeXmlAttribute(device)}" controller="${escapeXmlAttribute(ctrl)}" />\n`)
        .join('');

    // Whole lines only, same as default.cfg's own rewrite in boServer.ts.
    const withoutMapDevices = existing.replace(/[ \t]*<mapdevice\s[^>]*\/>[ \t]*\n?/g, '');
    const inputOpen = /<input>[ \t]*\n?/.exec(withoutMapDevices);
    if (inputOpen) {
        const at = inputOpen.index + inputOpen[0].length;
        const prefix = inputOpen[0].endsWith('\n') ? '' : '\n';
        return withoutMapDevices.slice(0, at) + prefix + entries + withoutMapDevices.slice(at);
    }
    if (!entries) {
        return withoutMapDevices;
    }
    return withoutMapDevices.replace(
        /(<system name="default">[ \t]*\n?)/,
        `$1        <input>\n${entries}        </input>\n`,
    );
}
