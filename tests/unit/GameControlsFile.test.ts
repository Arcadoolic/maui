import {describe, it, expect} from 'vitest';
import {buildGameControlsFile, parseGameControlsFile} from '@/class/GameControlsFile';
import type {GameCfgOverride} from '@/class/MameCfg';

const CODES = new Map([['KEYCODE_RIGHT', 'Right'], ['KEYCODE_LCONTROL', 'Left Ctrl']]);
const OVERRIDES: GameCfgOverride[] = [
    {portType: 'P1_BUTTON1', tag: ':P1', mask: 16, defvalue: 16, seqType: 'standard', seq: 'JOYCODE_1_BUTTON3 OR KEYCODE_LCONTROL'},
    {portType: 'P1_DIAL', tag: ':DIAL', mask: 255, defvalue: 0, seqType: 'increment', seq: 'KEYCODE_RIGHT'},
];

const fileOf = (content: object) => JSON.stringify({format: 'maui-mame-game-controls', version: 1, romName: 'arkanoid', controls: [], ...content});

describe('game controls file', () => {
    it('reads back what it exported', () => {
        const text = buildGameControlsFile('arkanoid', OVERRIDES, '0.289', new Date('2026-10-29T10:00:00Z'));
        expect(JSON.parse(text)).toMatchObject({format: 'maui-mame-game-controls', romName: 'arkanoid', mameVersion: '0.289'});
        expect(parseGameControlsFile(text, 'arkanoid', CODES)).toEqual(OVERRIDES);
    });

    it('refuses what is not an export, or the export of another game', () => {
        expect(() => parseGameControlsFile('nope', 'arkanoid', CODES)).toThrow('not JSON');
        expect(() => parseGameControlsFile('{"format":"maui-mame-controls"}', 'arkanoid', CODES)).toThrow('not a game controls export');
        expect(() => parseGameControlsFile(fileOf({romName: '../x'}), 'arkanoid', CODES)).toThrow('no valid game');
        expect(() => parseGameControlsFile(fileOf({romName: '1942'}), 'arkanoid', CODES)).toThrow('of "1942", not of "arkanoid"');
    });

    it('refuses invalid commands, unknown keys and duplicates', () => {
        const command = OVERRIDES[0];
        expect(() => parseGameControlsFile(fileOf({controls: [{...command, portType: 'UI_CANCEL'}]}), 'arkanoid', CODES)).toThrow('invalid command');
        expect(() => parseGameControlsFile(fileOf({controls: [{...command, tag: ':P1"/>'}]}), 'arkanoid', CODES)).toThrow('invalid command');
        expect(() => parseGameControlsFile(fileOf({controls: [{...command, mask: -1}]}), 'arkanoid', CODES)).toThrow('invalid command');
        expect(() => parseGameControlsFile(fileOf({controls: [{...command, seqType: 'other'}]}), 'arkanoid', CODES)).toThrow('invalid command');
        expect(() => parseGameControlsFile(fileOf({controls: [{...command, seq: 'KEYCODE_TYPO'}]}), 'arkanoid', CODES)).toThrow('does not know');
        expect(() => parseGameControlsFile(fileOf({controls: [command, command]}), 'arkanoid', CODES)).toThrow('twice');
    });
});
