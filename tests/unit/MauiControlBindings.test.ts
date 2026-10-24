import {describe, it, expect} from 'vitest';
import {
    addInput, defaultMauiBindings, describeMauiInput, hotkeyInputs, inputsOfKey, isDefaultKey, keyOfInput, MAUI_KEY_VALUES,
    mauiInputId, parseMauiBindings, parseMauiInputId, removeInput, resetKey, serializeMauiBindings, type MauiInput,
} from '@/class/MauiControlBindings';
import {defaultHotkeys} from '@/class/Hotkeys';

const ids = (inputs: MauiInput[]) => inputs.map(mauiInputId);

describe('defaults', () => {
    it('are the keyboard keys MAUI always used and controllers.json', () => {
        const bindings = defaultMauiBindings();
        expect(ids(inputsOfKey(bindings, 'Enter'))).toEqual([
            'key|Enter', 'button|0|standard',
            'button|0|Xin-Mo Xin-Mo Dual Arcade (Vendor: 16c0 Product: 05e1)',
            'button|2|Xin-Mo Xin-Mo Dual Arcade (Vendor: 16c0 Product: 05e1)',
        ]);
        expect(ids(inputsOfKey(bindings, 'ArrowUp'))).toContain('axis|1|0|standard');
        expect(Object.values(defaultMauiBindings().mouse)).toEqual([]);
    });

    it('give every MAUI key a keyboard key and an input on the "standard" pad layout', () => {
        // Any pad without a layout of its own follows "standard" (Gamepads.class.ts): a key with
        // no input there is unreachable from that pad.
        const bindings = defaultMauiBindings();
        for (const key of MAUI_KEY_VALUES) {
            const inputs = ids(inputsOfKey(bindings, key));
            expect(inputs, key).toContain(`key|${key}`);
            expect(inputs.some(id => id.endsWith('|standard')), key).toBe(true);
        }
    });

    it('are what a missing or broken file gives', () => {
        expect(parseMauiBindings(undefined)).toEqual(defaultMauiBindings());
        expect(parseMauiBindings('{nope')).toEqual(defaultMauiBindings());
    });
});

describe('parseMauiBindings / serializeMauiBindings', () => {
    it('round-trips', () => {
        const {bindings} = addInput(defaultMauiBindings(), 'Space', {device: 'mouse', button: 2});
        expect(parseMauiBindings(serializeMauiBindings(bindings))).toEqual(bindings);
    });

    it('drops anything that is not a MAUI key, and keeps a standard layout', () => {
        const parsed = parseMauiBindings(JSON.stringify({
            keyboard: {KeyQ: 'Enter', KeyW: 'Delete'},
            mouse: {0: 42},
            pads: {foo: {buttons: {0: 'Space', 1: ''}, axes: {0: {0: 'ArrowLeft', 1: 'Bogus'}}}},
        }));
        expect(parsed.keyboard).toEqual({KeyQ: 'Enter'});
        expect(parsed.mouse).toEqual({});
        expect(parsed.pads.foo).toEqual({buttons: {0: 'Space', 1: ''}, axes: {0: {0: 'ArrowLeft'}}});
        expect(parsed.pads.standard).toEqual(defaultMauiBindings().pads.standard);
    });
});

describe('addInput / removeInput', () => {
    it('adds next to the inputs already there', () => {
        const {bindings, takenFrom} = addInput(defaultMauiBindings(), 'Enter', {device: 'keyboard', code: 'KeyZ'});
        expect(takenFrom).toBeUndefined();
        expect(ids(inputsOfKey(bindings, 'Enter')).slice(0, 2)).toEqual(['key|Enter', 'key|KeyZ']);
    });

    it('takes an input from the key it had', () => {
        const {bindings, takenFrom} = addInput(defaultMauiBindings(), 'KeyP', {device: 'pad', layout: 'standard', button: 1});
        expect(takenFrom).toBe('Space');
        expect(keyOfInput(bindings, {device: 'pad', layout: 'standard', button: 1})).toBe('KeyP');
        expect(ids(inputsOfKey(bindings, 'Space'))).not.toContain('button|1|standard');
    });

    it('adds a pad axis and a mouse button', () => {
        let {bindings} = addInput(defaultMauiBindings(), 'ArrowUp', {device: 'pad', layout: 'standard', axis: 3, direction: 0});
        ({bindings} = addInput(bindings, 'Enter', {device: 'mouse', button: 0}));
        expect(keyOfInput(bindings, {device: 'pad', layout: 'standard', axis: 3, direction: 0})).toBe('ArrowUp');
        expect(keyOfInput(bindings, {device: 'mouse', button: 0})).toBe('Enter');
    });

    it('removes one input and leaves the others', () => {
        const bindings = removeInput(defaultMauiBindings(), {device: 'keyboard', code: 'Enter'});
        expect(keyOfInput(bindings, {device: 'keyboard', code: 'Enter'})).toBe('');
        expect(ids(inputsOfKey(bindings, 'Enter'))).toContain('button|0|standard');
    });
});

describe('resetKey / isDefaultKey', () => {
    it('gives a key its default inputs back, and only them', () => {
        let {bindings} = addInput(defaultMauiBindings(), 'KeyP', {device: 'keyboard', code: 'Enter'});
        ({bindings} = addInput(bindings, 'Enter', {device: 'keyboard', code: 'KeyZ'}));
        expect(isDefaultKey(bindings, 'Enter')).toBe(false);
        bindings = resetKey(bindings, 'Enter');
        expect(isDefaultKey(bindings, 'Enter')).toBe(true);
        expect(keyOfInput(bindings, {device: 'keyboard', code: 'Enter'})).toBe('Enter');
        expect(keyOfInput(bindings, {device: 'keyboard', code: 'KeyZ'})).toBe('');
    });
});

describe('mauiInputId / parseMauiInputId', () => {
    it('round-trips every kind, layouts with any character included', () => {
        const inputs: MauiInput[] = [
            {device: 'keyboard', code: 'KeyA'},
            {device: 'mouse', button: 2},
            {device: 'pad', layout: 'Xin-Mo | odd (Vendor: 16c0)', button: 8},
            {device: 'pad', layout: 'standard', axis: 1, direction: 1},
        ];
        for (const input of inputs) {
            expect(parseMauiInputId(mauiInputId(input))).toEqual(input);
        }
    });

    it('refuses anything malformed', () => {
        for (const id of ['', 'key|', 'key|<script>', 'mouse|7', 'button|x|standard', 'axis|1|2|standard', 'button|1']) {
            expect(parseMauiInputId(id)).toBeUndefined();
        }
    });
});

describe('describeMauiInput', () => {
    it('names inputs for the pills', () => {
        expect(describeMauiInput({device: 'keyboard', code: 'KeyA'})).toBe('A');
        expect(describeMauiInput({device: 'keyboard', code: 'ArrowUp'})).toBe('↑');
        expect(describeMauiInput({device: 'mouse', button: 2})).toBe('Right button');
        expect(describeMauiInput({device: 'pad', layout: 'standard', button: 0})).toBe('Button 0 (A)');
        expect(describeMauiInput({device: 'pad', layout: 'other', button: 8})).toBe('Button 8');
        expect(describeMauiInput({device: 'pad', layout: 'standard', axis: 1, direction: 0})).toBe('Stick up (axis 1 −)');
    });
});

describe('hotkeys in maui-controls.json', () => {
    it('keeps the hotkeys MAUI always had for a file from before them', () => {
        expect(parseMauiBindings(JSON.stringify({keyboard: {Enter: 'Enter'}})).hotkeys).toEqual(defaultHotkeys());
        expect(defaultMauiBindings().hotkeys).toEqual(defaultHotkeys());
    });

    it('keeps an empty list: no hotkey at all is a choice', () => {
        expect(parseMauiBindings(JSON.stringify({hotkeys: []})).hotkeys).toEqual([]);
    });

    it('reads MAUI keys and single inputs, and drops what is not a hotkey', () => {
        const hotkeys = parseMauiBindings(JSON.stringify({hotkeys: [
            {action: 'quit', keys: ['button|9|standard', 'maui|Space'], holdMs: 0},
            {action: 'quit', keys: ['maui|Nope'], holdMs: 0},
            {action: 'quit', keys: ['bogus'], holdMs: 0},
        ]})).hotkeys;
        expect(hotkeys).toEqual([{action: 'quit', keys: ['button|9|standard', 'maui|Space'], holdMs: 0}]);
    });

    it('survives a save and a read', () => {
        const bindings = {...defaultMauiBindings(), hotkeys: [{action: 'newPlayer' as const, keys: ['mouse|1'], holdMs: 500}]};
        expect(parseMauiBindings(serializeMauiBindings(bindings)).hotkeys).toEqual(bindings.hotkeys);
    });

    it('lists the single inputs the front must hear', () => {
        const bindings = {...defaultMauiBindings(), hotkeys: [{action: 'quit' as const, keys: ['button|9|standard', 'maui|Space'], holdMs: 0}]};
        expect([...hotkeyInputs(bindings)]).toEqual(['button|9|standard']);
    });
});
