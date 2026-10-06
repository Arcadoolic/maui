import {describe, it, expect} from 'vitest';
import {readCtrlrMapDevices, setCtrlrMapDevice} from '@/class/MameCtrlr';

const PS4 = '05009b514c050000c405000000810000';
const XBOX = '05008cba5e040000e002000003090000';

describe('setCtrlrMapDevice', () => {
    it('creates a controller file with the input block', () => {
        expect(setCtrlrMapDevice(undefined, XBOX, 'JOYCODE_1')).toBe(`<?xml version="1.0"?>
<mameconfig version="10">
    <system name="default">
        <input>
            <mapdevice device="${XBOX}" controller="JOYCODE_1" />
        </input>
    </system>
</mameconfig>
`);
    });

    it('keeps entries sorted by controller number', () => {
        const xml = setCtrlrMapDevice(setCtrlrMapDevice(undefined, PS4, 'JOYCODE_10'), XBOX, 'JOYCODE_2');
        expect(Array.from(readCtrlrMapDevices(xml).keys())).toEqual(['JOYCODE_2', 'JOYCODE_10']);
    });

    it('moves a device to its new controller and takes the controller from its previous device', () => {
        let xml = setCtrlrMapDevice(undefined, PS4, 'JOYCODE_1');
        xml = setCtrlrMapDevice(xml, XBOX, 'JOYCODE_2');
        xml = setCtrlrMapDevice(xml, XBOX, 'JOYCODE_1');
        expect(readCtrlrMapDevices(xml)).toEqual(new Map([['JOYCODE_1', XBOX]]));
    });

    it('unpins a device and leaves an empty input block', () => {
        const xml = setCtrlrMapDevice(setCtrlrMapDevice(undefined, PS4, 'JOYCODE_1'), PS4, null);
        expect(readCtrlrMapDevices(xml).size).toBe(0);
        expect(xml).toContain('<input>\n        </input>');
    });

    it('preserves the rest of a hand-written controller file', () => {
        const existing = `<?xml version="1.0"?>
<mameconfig version="10">
    <system name="default">
        <input>
            <mapdevice device="old" controller="JOYCODE_1" />
            <port type="P1_BUTTON1">
                <newseq type="standard">JOYCODE_1_BUTTON3</newseq>
            </port>
        </input>
    </system>
</mameconfig>
`;
        const xml = setCtrlrMapDevice(existing, PS4, 'JOYCODE_2');
        expect(readCtrlrMapDevices(xml)).toEqual(new Map([['JOYCODE_1', 'old'], ['JOYCODE_2', PS4]]));
        expect(xml).toContain('<port type="P1_BUTTON1">\n                <newseq type="standard">JOYCODE_1_BUTTON3</newseq>');
    });

    it('escapes device ids used as attributes', () => {
        const xml = setCtrlrMapDevice(undefined, 'Pad "A" & <B>', 'JOYCODE_1');
        expect(xml).toContain('device="Pad &quot;A&quot; &amp; &lt;B>"');
        expect(readCtrlrMapDevices(xml).get('JOYCODE_1')).toBe('Pad "A" & <B>');
    });
});
