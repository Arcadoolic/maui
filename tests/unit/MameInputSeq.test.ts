import {describe, it, expect} from 'vitest';
import {
    addSeqAlternative, browserKeyToken, browserKeyTokens, browserMouseToken, describeInputCode, describeSeqAlternative, inputCodeKind, parseInputDefaults, parseUiSeqs,
    mirrorSeqToOtherPlayer, otherPlayerPortType, removeSeqAlternative, removeTokenFromSeq, seqAlternativeKind,
    seqAlternatives, seqFromAlternatives,
} from '@/class/MameInputSeq';

describe('removeTokenFromSeq', () => {
    const uiMenu = 'KEYCODE_TAB NOT KEYCODE_LALT NOT KEYCODE_RALT OR JOYCODE_1_BUTTON9';

    it('drops the OR alternative holding the token and keeps the rest verbatim', () => {
        expect(removeTokenFromSeq(uiMenu, 'JOYCODE_1_BUTTON9')).toBe('KEYCODE_TAB NOT KEYCODE_LALT NOT KEYCODE_RALT');
    });

    it('drops a middle alternative', () => {
        expect(removeTokenFromSeq('KEYCODE_UP OR JOYCODE_1_HAT1UP OR JOYCODE_1_YAXIS_UP_SWITCH', 'JOYCODE_1_HAT1UP'))
            .toBe('KEYCODE_UP OR JOYCODE_1_YAXIS_UP_SWITCH');
    });

    it('returns the sequence unchanged when the token is absent', () => {
        expect(removeTokenFromSeq(uiMenu, 'JOYCODE_1_BUTTON1')).toBe(uiMenu);
    });

    it('matches whole codes only, not prefixes', () => {
        expect(removeTokenFromSeq(uiMenu, 'JOYCODE_1_BUTTON')).toBe(uiMenu);
        expect(removeTokenFromSeq('KEYCODE_ENTER OR JOYCODE_1_BUTTON1', 'JOYCODE_1_BUTTON1'))
            .toBe('KEYCODE_ENTER');
        expect(removeTokenFromSeq('KEYCODE_ENTER OR JOYCODE_1_BUTTON10', 'JOYCODE_1_BUTTON1'))
            .toBe('KEYCODE_ENTER OR JOYCODE_1_BUTTON10');
    });

    it('returns null when the token was the only alternative', () => {
        expect(removeTokenFromSeq('JOYCODE_1_BUTTON9', 'JOYCODE_1_BUTTON9')).toBeNull();
    });
});

describe('parseUiSeqs', () => {
    it('reads PORT|sequence lines', () => {
        expect(parseUiSeqs('UI_MENU|KEYCODE_TAB OR JOYCODE_1_BUTTON9\nUI_CANCEL|KEYCODE_ESC\n')).toEqual(new Map([
            ['UI_MENU', 'KEYCODE_TAB OR JOYCODE_1_BUTTON9'],
            ['UI_CANCEL', 'KEYCODE_ESC'],
        ]));
    });

    it('skips ports with an empty sequence and blank lines, and tolerates CRLF', () => {
        expect(parseUiSeqs('COIN10|\r\n\r\nUI_HOME|KEYCODE_HOME\r\n')).toEqual(new Map([['UI_HOME', 'KEYCODE_HOME']]));
    });
});

describe('seqAlternatives', () => {
    it('splits on OR and keeps combinations whole', () => {
        expect(seqAlternatives('KEYCODE_F3 KEYCODE_LSHIFT OR KEYCODE_F3  KEYCODE_RSHIFT')).toEqual([
            'KEYCODE_F3 KEYCODE_LSHIFT', 'KEYCODE_F3 KEYCODE_RSHIFT',
        ]);
    });

    it('has none for an empty sequence or NONE', () => {
        expect(seqAlternatives('')).toEqual([]);
        expect(seqAlternatives(' NONE ')).toEqual([]);
    });
});

describe('seqFromAlternatives', () => {
    it('joins with OR, NONE when empty', () => {
        expect(seqFromAlternatives(['KEYCODE_ESC', 'JOYCODE_1_BUTTON7'])).toBe('KEYCODE_ESC OR JOYCODE_1_BUTTON7');
        expect(seqFromAlternatives([])).toBe('NONE');
    });
});

describe('addSeqAlternative', () => {
    it('adds after what is there instead of replacing it', () => {
        expect(addSeqAlternative('KEYCODE_ESC', 'JOYCODE_1_BUTTON7')).toBe('KEYCODE_ESC OR JOYCODE_1_BUTTON7');
    });

    it('adds to an empty sequence', () => {
        expect(addSeqAlternative('NONE', 'KEYCODE_ESC')).toBe('KEYCODE_ESC');
    });

    it('does not add twice', () => {
        expect(addSeqAlternative('KEYCODE_ESC OR JOYCODE_1_BUTTON7', 'JOYCODE_1_BUTTON7')).toBe('KEYCODE_ESC OR JOYCODE_1_BUTTON7');
    });
});

describe('removeSeqAlternative', () => {
    it('removes one alternative and keeps the others', () => {
        expect(removeSeqAlternative('KEYCODE_UP OR JOYCODE_1_YAXIS_UP_SWITCH OR JOYCODE_1_HAT1UP', 'JOYCODE_1_YAXIS_UP_SWITCH'))
            .toBe('KEYCODE_UP OR JOYCODE_1_HAT1UP');
    });

    it('removes a combination as a whole', () => {
        expect(removeSeqAlternative('KEYCODE_TAB NOT KEYCODE_LALT NOT KEYCODE_RALT OR JOYCODE_1_BUTTON9',
            'KEYCODE_TAB NOT KEYCODE_LALT NOT KEYCODE_RALT')).toBe('JOYCODE_1_BUTTON9');
    });

    it('gives NONE when the last one goes', () => {
        expect(removeSeqAlternative('KEYCODE_ESC', 'KEYCODE_ESC')).toBe('NONE');
    });

    it('does not remove a combination holding the code', () => {
        expect(removeSeqAlternative('KEYCODE_F3 KEYCODE_LSHIFT OR KEYCODE_F3', 'KEYCODE_F3')).toBe('KEYCODE_F3 KEYCODE_LSHIFT');
    });
});

describe('parseInputDefaults', () => {
    it('reads the marked lines only', () => {
        const parsed = parseInputDefaults([
            'Warning: something',
            'MAUI_SEQ|UI_CANCEL|KEYCODE_ESC',
            'MAUI_SEQ|UI_PAUSE|',
            'MAUI_CODE|KEYCODE_ESC|Escape',
            'MAUI_CODE|KEYCODE_KEYPAD,|Keypad ,',
            'MAUI_CODE|MOUSECODE_1_BUTTON1|Button 1',
        ].join('\n'));
        expect(parsed.seqs).toEqual(new Map([['UI_CANCEL', 'KEYCODE_ESC'], ['UI_PAUSE', '']]));
        expect(parsed.codes).toEqual(new Map([
            ['KEYCODE_ESC', 'Escape'], ['KEYCODE_KEYPAD,', 'Keypad ,'], ['MOUSECODE_1_BUTTON1', 'Button 1'],
        ]));
    });
});

describe('describeInputCode', () => {
    const names = new Map([['KEYCODE_ESC', 'Escape'], ['MOUSECODE_1_BUTTON1', 'Button 1']]);

    it('uses MAME\'s key names', () => {
        expect(describeInputCode('KEYCODE_ESC', names)).toBe('Escape');
    });

    it('cuts down the other tokens', () => {
        expect(describeInputCode('JOYCODE_1_BUTTON7', names)).toBe('Joy 1 Button 7');
        expect(describeInputCode('MOUSECODE_1_BUTTON1', names)).toBe('Mouse 1 Button 1');
        expect(describeInputCode('JOYCODE_2_YAXIS_UP_SWITCH', names)).toBe('Joy 2 Yaxis Up Switch');
        expect(describeInputCode('KEYCODE_LSHIFT', new Map())).toBe('Key Lshift');
    });
});

describe('describeSeqAlternative', () => {
    const names = new Map([['KEYCODE_F5', 'F5'], ['KEYCODE_LSHIFT', 'Left Shift'], ['KEYCODE_RSHIFT', 'Right Shift'], ['KEYCODE_F3', 'F3']]);

    it('names combinations and NOT modifiers', () => {
        expect(describeSeqAlternative('KEYCODE_F5 NOT KEYCODE_LSHIFT NOT KEYCODE_RSHIFT', names)).toBe('F5 without Left Shift, Right Shift');
        expect(describeSeqAlternative('KEYCODE_F3 KEYCODE_LSHIFT', names)).toBe('F3 + Left Shift');
    });
});

describe('inputCodeKind / seqAlternativeKind', () => {
    it('tells the device from the token', () => {
        expect(inputCodeKind('KEYCODE_A')).toBe('keyboard');
        expect(inputCodeKind('MOUSECODE_1_BUTTON1')).toBe('mouse');
        expect(inputCodeKind('JOYCODE_1_BUTTON1')).toBe('joystick');
        expect(inputCodeKind('GUNCODE_1_BUTTON1')).toBe('lightgun');
        expect(seqAlternativeKind('KEYCODE_F3 KEYCODE_LSHIFT')).toBe('keyboard');
    });
});

describe('browserKeyToken', () => {
    it('maps browser key codes to MAME tokens', () => {
        expect(browserKeyToken('KeyA')).toBe('KEYCODE_A');
        expect(browserKeyToken('Digit5')).toBe('KEYCODE_5');
        expect(browserKeyToken('Numpad5')).toBe('KEYCODE_5PAD');
        expect(browserKeyToken('F12')).toBe('KEYCODE_F12');
        expect(browserKeyToken('Escape')).toBe('KEYCODE_ESC');
        expect(browserKeyToken('ControlLeft')).toBe('KEYCODE_LCONTROL');
        expect(browserKeyToken('Period')).toBe('KEYCODE_STOP');
        expect(browserKeyToken('NumpadComma')).toBe('KEYCODE_KEYPAD,');
    });

    it('knows nothing of keys MAME has no token for', () => {
        expect(browserKeyToken('AudioVolumeUp')).toBeUndefined();
        expect(browserKeyToken('F25')).toBeUndefined();
    });

    it('lists every code it knows', () => {
        const tokens = browserKeyTokens();
        expect(tokens.KeyZ).toBe('KEYCODE_Z');
        expect(Object.values(tokens).every(token => token.startsWith('KEYCODE_'))).toBe(true);
    });
});

describe('browserMouseToken', () => {
    it('numbers buttons left, middle, right like MAME', () => {
        expect(browserMouseToken(0)).toBe('MOUSECODE_1_BUTTON1');
        expect(browserMouseToken(1)).toBe('MOUSECODE_1_BUTTON2');
        expect(browserMouseToken(2)).toBe('MOUSECODE_1_BUTTON3');
        expect(browserMouseToken(5)).toBeUndefined();
    });
});

describe('otherPlayerPortType', () => {
    it('swaps players 1 and 2', () => {
        expect(otherPlayerPortType('P1_BUTTON3')).toBe('P2_BUTTON3');
        expect(otherPlayerPortType('P2_JOYSTICK_UP')).toBe('P1_JOYSTICK_UP');
        expect(otherPlayerPortType('COIN1')).toBe('COIN2');
        expect(otherPlayerPortType('START2')).toBe('START1');
    });

    it('has nothing for the other ports', () => {
        expect(otherPlayerPortType('UI_CANCEL')).toBeUndefined();
        expect(otherPlayerPortType('P3_BUTTON1')).toBeUndefined();
        expect(otherPlayerPortType('COIN3')).toBeUndefined();
    });
});

describe('mirrorSeqToOtherPlayer', () => {
    it('swaps joysticks 1 and 2 and keeps the target\'s own keys', () => {
        expect(mirrorSeqToOtherPlayer(
            'KEYCODE_LCONTROL OR JOYCODE_1_BUTTON1 OR JOYCODE_2_BUTTON5',
            'KEYCODE_A OR JOYCODE_2_BUTTON9',
        )).toBe('KEYCODE_A OR JOYCODE_2_BUTTON1 OR JOYCODE_1_BUTTON5');
    });

    it('leaves joysticks 3 and up as they are, and gives NONE when nothing is left', () => {
        expect(mirrorSeqToOtherPlayer('JOYCODE_3_HAT1UP', 'NONE')).toBe('JOYCODE_3_HAT1UP');
        expect(mirrorSeqToOtherPlayer('KEYCODE_5', 'JOYCODE_2_BUTTON7')).toBe('NONE');
    });
});
