import {describe, it, expect} from 'vitest';
import {
    compareGameFields,
    gameFieldId,
    inputIconKey,
    isAnalogPortType,
    isRemappablePortType,
    listGameCfgOverrides,
    parseGameFields,
    readGameCfgInputSeqs,
    removeAllGameCfgInputSeqs,
    removeGameCfgInputSeq,
    setGameCfgInputSeq,
    type GameField,
} from '@/class/MameCfg';

const button1: GameField = {portType: 'P1_BUTTON1', tag: ':P1', mask: 16, defvalue: 16, defaultSeq: 'KEYCODE_LCONTROL', name: 'P1 Button 1'};
const button2: GameField = {portType: 'P1_BUTTON2', tag: ':P1', mask: 32, defvalue: 32, defaultSeq: 'KEYCODE_LALT', name: 'P1 Button 2'};

const cfgWithMixer = `<?xml version="1.0"?>
<mameconfig version="10">
    <system name="1942">
        <mixer>
            <sound_map tag=":mono" />
        </mixer>
    </system>
</mameconfig>
`;

describe('parseGameFields', () => {
    it('parses remappable fields and skips the rest', () => {
        const content = [
            'P1_BUTTON1|:P1|16|16|KEYCODE_LCONTROL OR MOUSECODE_1_BUTTON1|P1 Button 1',
            'COIN1|:SYSTEM|128|128|KEYCODE_5|Coin 1',
            'DIPSWITCH|:DSWA|7|7||Coin A',
            'P1_BUTTON2|:P1|bad|32|KEYCODE_LALT|P1 Button 2',
            '',
        ].join('\n');
        expect(parseGameFields(content)).toEqual([
            {portType: 'P1_BUTTON1', tag: ':P1', mask: 16, defvalue: 16, defaultSeq: 'KEYCODE_LCONTROL OR MOUSECODE_1_BUTTON1', name: 'P1 Button 1'},
            {portType: 'COIN1', tag: ':SYSTEM', mask: 128, defvalue: 128, defaultSeq: 'KEYCODE_5', name: 'Coin 1'},
        ]);
    });
});

describe('isRemappablePortType', () => {
    it('accepts directions, buttons, coin, start and analog controls only', () => {
        expect(['P1_JOYSTICK_UP', 'P2_BUTTON8', 'COIN2', 'START1', 'P4_BUTTON12', 'P1_DIAL', 'P2_TRACKBALL_Y', 'P1_PADDLE']
            .every(isRemappablePortType)).toBe(true);
        expect(['UI_CANCEL', 'DIPSWITCH', 'SERVICE1', 'P5_BUTTON1', 'P1_DIALX'].some(isRemappablePortType)).toBe(false);
    });

    it('tells the analog ones', () => {
        expect(isAnalogPortType('P1_DIAL')).toBe(true);
        expect(isAnalogPortType('P1_BUTTON1')).toBe(false);
    });
});

describe('analog fields', () => {
    const dial: GameField = {
        portType: 'P1_DIAL', tag: ':P1', mask: 255, defvalue: 0, defaultSeq: 'MOUSECODE_1_XAXIS', name: 'Dial',
        analog: {increment: 'KEYCODE_RIGHT', decrement: 'KEYCODE_LEFT'},
    };

    it('takes the increment and decrement sequences from game-analog.txt', () => {
        const fields = parseGameFields(
            'P1_DIAL|:P1|255|0|MOUSECODE_1_XAXIS OR JOYCODE_1_XAXIS|Dial\nP1_BUTTON1|:BUTTONS|1|1|KEYCODE_LCONTROL|P1 Button 1\n',
            ':P1|255|KEYCODE_RIGHT|KEYCODE_LEFT\n',
        );
        expect(fields[0].analog).toEqual({increment: 'KEYCODE_RIGHT', decrement: 'KEYCODE_LEFT'});
        expect(fields[1].analog).toBeUndefined();
    });

    it('sets, reads and removes each sequence type on its own', () => {
        let xml = setGameCfgInputSeq(undefined, 'arkanoid', dial, 'KEYCODE_D', 'increment');
        xml = setGameCfgInputSeq(xml, 'arkanoid', dial, 'NONE', 'decrement');
        xml = setGameCfgInputSeq(xml, 'arkanoid', dial, 'JOYCODE_1_XAXIS', 'standard');
        expect(xml.match(/<port /g)).toHaveLength(1);
        expect(readGameCfgInputSeqs(xml, 'increment').get(gameFieldId(dial))).toBe('KEYCODE_D');
        expect(readGameCfgInputSeqs(xml, 'decrement').get(gameFieldId(dial))).toBe('NONE');
        expect(readGameCfgInputSeqs(xml).get(gameFieldId(dial))).toBe('JOYCODE_1_XAXIS');

        xml = removeGameCfgInputSeq(xml, dial, 'increment');
        expect(readGameCfgInputSeqs(xml, 'increment').size).toBe(0);
        expect(readGameCfgInputSeqs(xml, 'decrement').get(gameFieldId(dial))).toBe('NONE');
        xml = removeGameCfgInputSeq(removeGameCfgInputSeq(xml, dial, 'decrement'), dial);
        expect(xml).not.toContain('<input>');
    });
});

describe('compareGameFields', () => {
    it('sorts by player, then directions, buttons, start and coin', () => {
        const make = (portType: string): GameField => ({portType, tag: ':X', mask: 1, defvalue: 1, defaultSeq: '', name: ''});
        const sorted = ['COIN1', 'P2_BUTTON1', 'P1_BUTTON10', 'START1', 'P1_BUTTON2', 'P1_JOYSTICK_LEFT', 'P1_JOYSTICK_UP']
            .map(make).sort(compareGameFields).map(field => field.portType);
        expect(sorted).toEqual(['P1_JOYSTICK_UP', 'P1_JOYSTICK_LEFT', 'P1_BUTTON2', 'P1_BUTTON10', 'START1', 'COIN1', 'P2_BUTTON1']);
    });
});

describe('setGameCfgInputSeq', () => {
    it('creates a fresh cfg when there is none', () => {
        const xml = setGameCfgInputSeq(undefined, 'pacman', button1, 'JOYCODE_1_BUTTON3');
        expect(xml).toContain('<system name="pacman">');
        expect(xml).toContain('<port type="P1_BUTTON1" tag=":P1" mask="16" defvalue="16">');
        expect(readGameCfgInputSeqs(xml).get(gameFieldId(button1))).toBe('JOYCODE_1_BUTTON3');
    });

    it('adds an <input> block to an existing cfg and keeps the rest verbatim', () => {
        const xml = setGameCfgInputSeq(cfgWithMixer, '1942', button1, 'JOYCODE_1_BUTTON3');
        expect(xml).toContain('<mixer>\n            <sound_map tag=":mono" />\n        </mixer>');
        expect(readGameCfgInputSeqs(xml).get(gameFieldId(button1))).toBe('JOYCODE_1_BUTTON3');
    });

    it('replaces the existing override of the same field only', () => {
        let xml = setGameCfgInputSeq(cfgWithMixer, '1942', button1, 'JOYCODE_1_BUTTON3');
        xml = setGameCfgInputSeq(xml, '1942', button2, 'JOYCODE_1_BUTTON4');
        xml = setGameCfgInputSeq(xml, '1942', button1, 'JOYCODE_1_BUTTON5');
        const seqs = readGameCfgInputSeqs(xml);
        expect(seqs.get(gameFieldId(button1))).toBe('JOYCODE_1_BUTTON5');
        expect(seqs.get(gameFieldId(button2))).toBe('JOYCODE_1_BUTTON4');
        expect(seqs.size).toBe(2);
        expect(xml.match(/<input>/g)).toHaveLength(1);
    });

    it('does not confuse fields sharing a type but not tag/mask', () => {
        const other: GameField = {...button1, tag: ':P1B', mask: 1, defvalue: 1};
        let xml = setGameCfgInputSeq(undefined, 'x', button1, 'JOYCODE_1_BUTTON1');
        xml = setGameCfgInputSeq(xml, 'x', other, 'JOYCODE_1_BUTTON2');
        expect(readGameCfgInputSeqs(xml).size).toBe(2);
    });

    it('keeps other newseq types of a matching port', () => {
        const xml = `<mameconfig version="10">
    <system name="x">
        <input>
            <port type="P1_BUTTON1" tag=":P1" mask="16" defvalue="16">
                <newseq type="increment">KEYCODE_A</newseq>
            </port>
        </input>
    </system>
</mameconfig>`;
        const updated = setGameCfgInputSeq(xml, 'x', button1, 'JOYCODE_1_BUTTON3');
        expect(updated).toContain('<newseq type="increment">KEYCODE_A</newseq>');
        expect(readGameCfgInputSeqs(updated).get(gameFieldId(button1))).toBe('JOYCODE_1_BUTTON3');
    });

    it('throws rather than clobbering a cfg without a <system> element', () => {
        expect(() => setGameCfgInputSeq('<mameconfig version="10"></mameconfig>', 'x', button1, 'A')).toThrow();
    });
});

describe('readGameCfgInputSeqs', () => {
    it('reads MAME-written multi-line sequences and ignores ports without a standard newseq', () => {
        const xml = `<mameconfig version="10">
    <system name="x">
        <input>
            <port type="P1_BUTTON1" tag=":P1" mask="16" defvalue="16">
                <newseq type="standard">
                    KEYCODE_A OR JOYCODE_1_BUTTON1
                </newseq>
            </port>
            <port type="P1_BUTTON2" tag=":P1" mask="32" defvalue="32" />
        </input>
    </system>
</mameconfig>`;
        const seqs = readGameCfgInputSeqs(xml);
        expect(seqs.size).toBe(1);
        expect(seqs.get(gameFieldId(button1))).toBe('KEYCODE_A OR JOYCODE_1_BUTTON1');
    });

    it('returns nothing when there is no <input> block', () => {
        expect(readGameCfgInputSeqs(cfgWithMixer).size).toBe(0);
    });
});

describe('removeGameCfgInputSeq', () => {
    it('removes one override and keeps the other', () => {
        let xml = setGameCfgInputSeq(cfgWithMixer, '1942', button1, 'JOYCODE_1_BUTTON3');
        xml = setGameCfgInputSeq(xml, '1942', button2, 'JOYCODE_1_BUTTON4');
        const seqs = readGameCfgInputSeqs(removeGameCfgInputSeq(xml, button1));
        expect([...seqs.keys()]).toEqual([gameFieldId(button2)]);
    });

    it('drops the emptied <input> block and preserves the rest', () => {
        const xml = setGameCfgInputSeq(cfgWithMixer, '1942', button1, 'JOYCODE_1_BUTTON3');
        const cleaned = removeGameCfgInputSeq(xml, button1);
        expect(cleaned).not.toContain('<input>');
        expect(cleaned).toContain('<sound_map tag=":mono" />');
    });

    it('keeps a port that still holds another newseq', () => {
        const xml = `<mameconfig version="10">
    <system name="x">
        <input>
            <port type="P1_BUTTON1" tag=":P1" mask="16" defvalue="16">
                <newseq type="standard">KEYCODE_A</newseq>
                <newseq type="increment">KEYCODE_B</newseq>
            </port>
        </input>
    </system>
</mameconfig>`;
        const cleaned = removeGameCfgInputSeq(xml, button1);
        expect(cleaned).toContain('<newseq type="increment">KEYCODE_B</newseq>');
        expect(readGameCfgInputSeqs(cleaned).size).toBe(0);
    });

    it('returns the xml unchanged when there is nothing to remove', () => {
        expect(removeGameCfgInputSeq(cfgWithMixer, button1)).toBe(cfgWithMixer);
    });
});

describe('inputIconKey', () => {
    it('maps every remappable port type to its icon', () => {
        expect(inputIconKey('UI_CANCEL')).toBe('quit');
        expect(inputIconKey('UI_PAUSE')).toBe('pause');
        expect(inputIconKey('UI_MENU')).toBe('menu');
        expect(inputIconKey('SERVICE')).toBe('service');
        expect(inputIconKey('UI_SOFT_RESET')).toBe('soft_reset');
        expect(inputIconKey('UI_RESET_MACHINE')).toBe('hard_reset');
        expect(inputIconKey('COIN2')).toBe('coin');
        expect(inputIconKey('START1')).toBe('start');
        expect(inputIconKey('P2_JOYSTICK_LEFT')).toBe('joystick_left');
        expect(inputIconKey('P1_JOYSTICK_UP')).toBe('joystick_up');
        expect(inputIconKey('P1_BUTTON3')).toBe('button_3');
    });

    it('falls back to the plain button past 9, and to nothing for anything else', () => {
        expect(inputIconKey('P1_BUTTON12')).toBe('button');
        expect(inputIconKey('UI_CONFIGURE')).toBeUndefined();
        expect(inputIconKey('P1_JOYSTICKLEFT_UP')).toBeUndefined();
    });
});

describe('listGameCfgOverrides / removeAllGameCfgInputSeqs', () => {
    const cfg = `<?xml version="1.0"?>
<mameconfig version="10">
    <system name="1942">
        <input>
            <port tag=":DSWA" type="DIPSWITCH" mask="7" defvalue="7" value="3" />
            <port type="P1_BUTTON1" tag=":P1" mask="16" defvalue="16">
                <newseq type="standard">
                    JOYCODE_1_BUTTON3
                </newseq>
            </port>
            <port type="P1_DIAL" tag=":DIAL" mask="255" defvalue="0">
                <newseq type="increment">
                    KEYCODE_RIGHT
                </newseq>
            </port>
        </input>
        <mixer>
            <sound_map tag=":mono" />
        </mixer>
    </system>
</mameconfig>
`;

    it('lists every override with what MAME matches it by', () => {
        expect(listGameCfgOverrides(cfg)).toEqual([
            {portType: 'P1_BUTTON1', tag: ':P1', mask: 16, defvalue: 16, seqType: 'standard', seq: 'JOYCODE_1_BUTTON3'},
            {portType: 'P1_DIAL', tag: ':DIAL', mask: 255, defvalue: 0, seqType: 'increment', seq: 'KEYCODE_RIGHT'},
        ]);
    });

    it('drops the overrides and keeps the DIP switches and the mixer', () => {
        const cleaned = removeAllGameCfgInputSeqs(cfg);
        expect(listGameCfgOverrides(cleaned)).toEqual([]);
        expect(cleaned).toContain('<port tag=":DSWA" type="DIPSWITCH" mask="7" defvalue="7" value="3" />');
        expect(cleaned).toContain('<sound_map tag=":mono" />');
        expect(cleaned).not.toContain('P1_BUTTON1');
    });

    it('drops the input block once nothing is left in it', () => {
        expect(removeAllGameCfgInputSeqs(setGameCfgInputSeq(cfgWithMixer, '1942', button1, 'JOYCODE_1_BUTTON1')))
            .toBe(cfgWithMixer);
    });
});
