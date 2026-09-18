import {describe, it, expect} from 'vitest';
import {removeTokenFromSeq, parseUiSeqs} from '@/class/MameInputSeq';

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
