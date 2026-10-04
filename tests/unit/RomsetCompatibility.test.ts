import {describe, expect, it} from 'vitest';
import {findIncompatibleGames, parseListXml} from '@/class/RomsetCompatibility';

// As `mame -listxml mslug dkong` prints it: the games and their devices, not the BIOS (neogeo),
// whose ROMs are repeated in the game.
const LIST_XML = `<?xml version="1.0"?>
<mame build="0.289 (unknown)">
\t<machine name="mslug" sourcefile="neogeo/neogeo.cpp" romof="neogeo">
\t\t<description>Metal Slug - Super Vehicle-001</description>
\t\t<rom name="sp-s2.sp1" merge="sp-s2.sp1" bios="euro" size="131072" crc="9036d879" sha1="x" region="mainbios" offset="0"/>
\t\t<rom name="201-p1.p1" size="2097152" crc="08d8daa5" sha1="x" region="maincpu" offset="100000"/>
\t\t<rom name="pal.bin" size="1" status="nodump" region="plds" offset="0"/>
\t\t<device_ref name="z80"/>
\t\t<device_ref name="ym2610"/>
\t</machine>
\t<machine name="dkong" sourcefile="nintendo/dkong.cpp">
\t\t<rom name="c_5et_g.bin" size="4096" crc="BA70B88B" sha1="x" region="maincpu" offset="0"/>
\t\t<device_ref name="m58817"/>
\t</machine>
\t<machine name="ym2610" sourcefile="src/devices/sound/ym2610.cpp" isdevice="yes" runnable="no">
\t\t<rom name="ym2610.bin" size="8192" crc="1c3f4a6f" sha1="x" region="ym2610" offset="0"/>
\t</machine>
\t<machine name="z80" sourcefile="src/devices/cpu/z80/z80.cpp" isdevice="yes" runnable="no">
\t</machine>
</mame>
`;

const game = (romName: string, hasRomFile = true) => ({romName, hasRomFile}) as never;
const ROMSETS = {
    mslug: ['08d8daa5:2097152'],
    neogeo: ['9036d879:131072'],
    ym2610: ['1c3f4a6f:8192'],
    dkong: ['ba70b88b:4096'],
};

describe('parseListXml', () => {
    it('reads what each machine needs and where from', () => {
        const machines = parseListXml(LIST_XML);

        expect([...machines.keys()]).toEqual(['mslug', 'dkong', 'ym2610', 'z80']);
        expect(machines.get('mslug')).toMatchObject({romof: 'neogeo', cloneof: null, deviceRefs: ['z80', 'ym2610']});
        // No CRC is asked of a ROM without a good dump.
        expect([...(machines.get('mslug')?.roms ?? [])]).toEqual([['sp-s2.sp1', '9036d879:131072'], ['201-p1.p1', '08d8daa5:2097152']]);
        expect(machines.get('dkong')?.roms.get('c_5et_g.bin')).toBe('ba70b88b:4096');
    });
});

describe('findIncompatibleGames', () => {
    const machines = parseListXml(LIST_XML);

    it('finds nothing wrong when the pack holds every ROM, wherever MAME takes it from', () => {
        const manifest = {games: [game('mslug'), game('dkong')], romsets: ROMSETS};

        expect(findIncompatibleGames(manifest, machines)).toEqual(new Map());
    });

    it('names the ROM another MAME version expects differently', () => {
        const manifest = {games: [game('mslug'), game('dkong')], romsets: {...ROMSETS, dkong: ['00000000:4096']}};

        expect(findIncompatibleGames(manifest, machines)).toEqual(new Map([['dkong', 'the pack lacks dkong/c_5et_g.bin']]));
    });

    it('needs the BIOS and the devices of a game too', () => {
        const manifest = {games: [game('mslug')], romsets: {mslug: ROMSETS.mslug, dkong: ROMSETS.dkong}};

        expect(findIncompatibleGames(manifest, machines)).toEqual(
            new Map([['mslug', 'the pack lacks mslug/sp-s2.sp1, ym2610/ym2610.bin']]),
        );
    });

    it('rejects a game this MAME does not know', () => {
        const manifest = {games: [game('nope')], romsets: {nope: ['12345678:1']}};

        expect(findIncompatibleGames(manifest, machines)).toEqual(new Map([['nope', 'it does not know this game']]));
    });

    it('says nothing without romsets, nor of a game whose set is not described', () => {
        expect(findIncompatibleGames({games: [game('dkong')]}, machines)).toBeNull();
        expect(findIncompatibleGames({games: [game('nope'), game('dkong', false)], romsets: {}}, machines)).toEqual(new Map());
    });
});
