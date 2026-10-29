import {describe, it, expect} from 'vitest';
import {buildMameControlsFile, isImportableSeq, parseMameControlsFile} from '@/class/MameControlsFile';
import type {InputDefaults} from '@/class/MameInputSeq';

const XBOX = '05008cba5e040000e002000003090000';

const DEFAULTS: InputDefaults = {
    seqs: new Map([
        ['P1_BUTTON1', 'KEYCODE_LCONTROL OR JOYCODE_1_BUTTON1'],
        ['UI_CANCEL', 'KEYCODE_ESC'],
        ['COIN1', 'KEYCODE_5'],
    ]),
    codes: new Map([['KEYCODE_LCONTROL', 'Left Ctrl'], ['KEYCODE_ESC', 'Esc'], ['KEYCODE_5', '5'], ['KEYCODE_LALT', 'Left Alt']]),
};

const fileOf = (content: object) => JSON.stringify({format: 'maui-mame-controls', version: 1, pinnedDevices: [], ...content});

describe('MAME controls file', () => {
    it('reads back what it exported', () => {
        const text = buildMameControlsFile({
            controls: new Map([['P1_BUTTON1', 'JOYCODE_1_BUTTON3'], ['UI_CANCEL', 'KEYCODE_ESC NOT KEYCODE_LALT OR JOYCODE_1_BUTTON9']]),
            pinnedDevices: new Map([['JOYCODE_1', XBOX]]),
        }, '0.289', new Date('2026-10-29T10:00:00Z'));

        expect(JSON.parse(text)).toMatchObject({format: 'maui-mame-controls', version: 1, mameVersion: '0.289', exportedAt: '2026-10-29T10:00:00.000Z'});
        const parsed = parseMameControlsFile(text, DEFAULTS);
        expect(parsed.controls).toEqual(new Map([
            ['P1_BUTTON1', 'JOYCODE_1_BUTTON3'],
            ['UI_CANCEL', 'KEYCODE_ESC NOT KEYCODE_LALT OR JOYCODE_1_BUTTON9'],
        ]));
        expect(parsed.pinnedDevices).toEqual(new Map([['JOYCODE_1', XBOX]]));
    });

    it('refuses what is not an export', () => {
        expect(() => parseMameControlsFile('not json', DEFAULTS)).toThrow('not JSON');
        expect(() => parseMameControlsFile('{"format":"maui-my-favourites","games":[]}', DEFAULTS)).toThrow('not a MAME controls export');
        expect(() => parseMameControlsFile(fileOf({controls: []}), DEFAULTS)).toThrow('not a MAME controls export');
    });

    it('refuses a control this MAME does not have', () => {
        expect(() => parseMameControlsFile(fileOf({controls: {P9_BUTTON42: 'KEYCODE_5'}}), DEFAULTS)).toThrow('no "P9_BUTTON42"');
    });

    it('refuses a key this MAME does not know, or anything that is not a sequence', () => {
        expect(() => parseMameControlsFile(fileOf({controls: {COIN1: 'KEYCODE_TYPO'}}), DEFAULTS)).toThrow('does not know');
        expect(() => parseMameControlsFile(fileOf({controls: {COIN1: 'KEYCODE_5</newseq>'}}), DEFAULTS)).toThrow('does not know');
        expect(() => parseMameControlsFile(fileOf({controls: {COIN1: 5}}), DEFAULTS)).toThrow('does not know');
    });

    it('refuses invalid or duplicate pins', () => {
        const controls = {};
        expect(() => parseMameControlsFile(fileOf({controls, pinnedDevices: [{controller: 'JOY1', device: XBOX}]}), DEFAULTS))
            .toThrow('invalid pinned gamepad');
        expect(() => parseMameControlsFile(fileOf({controls, pinnedDevices: [{controller: 'JOYCODE_1', device: ''}]}), DEFAULTS))
            .toThrow('invalid pinned gamepad');
        expect(() => parseMameControlsFile(fileOf({controls, pinnedDevices: [
            {controller: 'JOYCODE_1', device: XBOX}, {controller: 'JOYCODE_2', device: XBOX},
        ]}), DEFAULTS)).toThrow('twice');
    });
});

describe('isImportableSeq', () => {
    const codes = DEFAULTS.codes;

    it('takes MAME sequences', () => {
        expect(isImportableSeq('NONE', codes)).toBe(true);
        expect(isImportableSeq('JOYCODE_2_HAT1UP OR JOYCODE_2_YAXIS_UP_SWITCH', codes)).toBe(true);
        expect(isImportableSeq('KEYCODE_ESC NOT KEYCODE_LALT', codes)).toBe(true);
        expect(isImportableSeq('MOUSECODE_1_BUTTON2 OR GUNCODE_1_BUTTON1', codes)).toBe(true);
    });

    it('refuses broken ones', () => {
        expect(isImportableSeq('', codes)).toBe(false);
        expect(isImportableSeq('OR KEYCODE_5', codes)).toBe(false);
        expect(isImportableSeq('KEYCODE_5 OR', codes)).toBe(false);
        expect(isImportableSeq('KEYCODE_5 NOT', codes)).toBe(false);
        expect(isImportableSeq('KEYCODE_5 NONE', codes)).toBe(false);
        expect(isImportableSeq('JOYCODE_X_BUTTON1', codes)).toBe(false);
    });
});
