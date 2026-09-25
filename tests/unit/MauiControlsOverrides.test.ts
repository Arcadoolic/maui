import {describe, it, expect} from 'vitest';
import {
    bindGamepadInput, resetMauiKey, mergeControllerMappings, mergeMapping, describeGamepadInputs, describeGamepadInput,
    mappingNameOf, type ControllerMappingOverrides,
} from '@/class/MauiControls';

const base: Record<string, ControllerMapping> = {
    standard: {
        buttons: {0: 'Enter', 1: 'Space', 2: 'KeyP', 3: ''},
        axes: {0: {0: 'ArrowLeft', 1: 'ArrowRight'}},
    },
    pad: {buttons: {0: 'Enter', 2: 'Enter'}, axes: {}},
};

describe('bindGamepadInput', () => {
    it('replaces the inputs bound to the key and saves only the differences', () => {
        const overrides = bindGamepadInput(base, {}, 'standard', 'Enter', {kind: 'button', index: 3}, true);
        expect(overrides).toEqual({standard: {buttons: {0: '', 3: 'Enter'}, axes: {}}});
        expect(describeGamepadInputs(mergeMapping(base.standard, overrides.standard), 'Enter')).toEqual(['Button 3']);
    });

    it('adds an input without dropping the existing ones', () => {
        const overrides = bindGamepadInput(base, {}, 'pad', 'Enter', {kind: 'button', index: 5}, false);
        expect(describeGamepadInputs(mergeMapping(base.pad, overrides.pad), 'Enter'))
            .toEqual(['Button 0', 'Button 2', 'Button 5']);
    });

    it('takes the input away from the key it produced before', () => {
        const overrides = bindGamepadInput(base, {}, 'standard', 'KeyP', {kind: 'button', index: 1}, true);
        const merged = mergeMapping(base.standard, overrides.standard);
        expect(describeGamepadInputs(merged, 'Space')).toEqual([]);
        expect(describeGamepadInputs(merged, 'KeyP')).toEqual(['Button 1']);
    });

    it('binds axis halves', () => {
        const overrides = bindGamepadInput(base, {}, 'standard', 'ArrowUp', {kind: 'axis', index: 1, direction: 0}, true);
        expect(overrides.standard.axes).toEqual({1: {0: 'ArrowUp'}});
    });

    it('drops the override once it matches the base layout again', () => {
        const moved = bindGamepadInput(base, {}, 'standard', 'Enter', {kind: 'button', index: 3}, true);
        expect(bindGamepadInput(base, moved, 'standard', 'Enter', {kind: 'button', index: 0}, true)).toEqual({});
    });

    it('bases an unknown pad on the standard layout, under its own name', () => {
        const overrides = bindGamepadInput(base, {}, 'Some Pad (Vendor: 1234)', 'Enter', {kind: 'button', index: 3}, true);
        const merged = mergeControllerMappings(base, overrides);
        expect(describeGamepadInputs(merged['Some Pad (Vendor: 1234)'], 'Enter')).toEqual(['Button 3']);
        expect(describeGamepadInputs(merged['Some Pad (Vendor: 1234)'], 'Space')).toEqual(['Button 1']);
        expect(merged.standard).toEqual(base.standard);
    });
});

describe('resetMauiKey', () => {
    it('restores the base inputs of the key and keeps the other overrides', () => {
        let overrides: ControllerMappingOverrides = bindGamepadInput(base, {}, 'standard', 'Enter', {kind: 'button', index: 3}, true);
        overrides = bindGamepadInput(base, overrides, 'standard', 'ArrowUp', {kind: 'axis', index: 1, direction: 0}, true);
        overrides = resetMauiKey(base, overrides, 'standard', 'Enter');
        expect(overrides).toEqual({standard: {buttons: {}, axes: {1: {0: 'ArrowUp'}}}});
    });

    it('gives back an input the key had lost to another key', () => {
        const overrides = bindGamepadInput(base, {}, 'standard', 'KeyP', {kind: 'button', index: 1}, true);
        // Button 1 is Space again; KeyP keeps its own override (button 2 still unbound).
        expect(resetMauiKey(base, overrides, 'standard', 'Space')).toEqual({standard: {buttons: {2: ''}, axes: {}}});
    });
});

describe('helpers', () => {
    it('names a pad like Gamepads.class.ts looks it up', () => {
        expect(mappingNameOf('standard', 'Xbox pad')).toBe('standard');
        expect(mappingNameOf('', 'Xbox pad')).toBe('Xbox pad');
    });

    it('describes a single input', () => {
        expect(describeGamepadInput({kind: 'button', index: 3}, {3: 'Y'})).toBe('Button 3 (Y)');
        expect(describeGamepadInput({kind: 'axis', index: 1, direction: 1})).toBe('Axis 1 +');
    });
});
