import {describe, it, expect} from 'vitest';
import {parseUiModeSetting, resolveUiMode} from '@/class/UiMode';

const GIB = 1024 ** 3;

describe('parseUiModeSetting', () => {
    it('keeps the three known settings', () => {
        expect(parseUiModeSetting('auto')).toBe('auto');
        expect(parseUiModeSetting('lite')).toBe('lite');
        expect(parseUiModeSetting('full')).toBe('full');
    });

    it('reads anything else as auto', () => {
        expect(parseUiModeSetting(undefined)).toBe('auto');
        expect(parseUiModeSetting('LITE')).toBe('auto');
        expect(parseUiModeSetting(true)).toBe('auto');
    });
});

describe('resolveUiMode', () => {
    it('obeys an explicit setting whatever the hardware', () => {
        expect(resolveUiMode('full', {totalMemBytes: 0.9 * GIB, gpuCompositing: 'disabled_software'})).toBe('full');
        expect(resolveUiMode('lite', {totalMemBytes: 32 * GIB, gpuCompositing: 'enabled'})).toBe('lite');
    });

    it('auto: lite at or under 2 GiB of memory', () => {
        // The Raspberry Pi 3 the mode was made for reports 905 MiB.
        expect(resolveUiMode('auto', {totalMemBytes: 905 * 1024 ** 2, gpuCompositing: 'enabled'})).toBe('lite');
        expect(resolveUiMode('auto', {totalMemBytes: 2 * GIB, gpuCompositing: 'enabled'})).toBe('lite');
        expect(resolveUiMode('auto', {totalMemBytes: 4 * GIB, gpuCompositing: 'enabled'})).toBe('full');
    });

    it('auto: lite when Chromium composites in software', () => {
        expect(resolveUiMode('auto', {totalMemBytes: 8 * GIB, gpuCompositing: 'disabled_software'})).toBe('lite');
    });

    it('auto: an unreadable GPU status decides nothing', () => {
        expect(resolveUiMode('auto', {totalMemBytes: 8 * GIB})).toBe('full');
        expect(resolveUiMode('auto', {totalMemBytes: 1 * GIB})).toBe('lite');
    });
});
