import {describe, it, expect, vi} from 'vitest';
import {parseMameVersion, readMameVersion, UNKNOWN_MAME_VERSION} from '@/class/MameVersion';

describe('parseMameVersion', () => {
    it('keeps the version number of `mame -version`', () => {
        expect(parseMameVersion('0.272 (mame0272)\n')).toBe('0.272');
    });

    it('keeps a suffix glued to the number', () => {
        expect(parseMameVersion('0.261b (unknown)\n')).toBe('0.261b');
    });

    it('is unknown for anything else', () => {
        expect(parseMameVersion('')).toBe(UNKNOWN_MAME_VERSION);
        expect(parseMameVersion('Usage: mame [options]')).toBe(UNKNOWN_MAME_VERSION);
    });

    it('never exceeds the contract maximum length', () => {
        expect(parseMameVersion('0.' + '9'.repeat(40)).length).toBeLessThanOrEqual(32);
    });
});

describe('readMameVersion', () => {
    it('runs the configured binary with -version', async () => {
        const execFile = vi.fn(async () => '0.272 (mame0272)\n');
        expect(await readMameVersion('/opt/mame/mame', execFile)).toBe('0.272');
        expect(execFile).toHaveBeenCalledWith('/opt/mame/mame', ['-version']);
    });

    it('is unknown when the binary is not configured', async () => {
        const execFile = vi.fn(async () => '0.272');
        expect(await readMameVersion('', execFile)).toBe(UNKNOWN_MAME_VERSION);
        expect(execFile).not.toHaveBeenCalled();
    });

    it('is unknown when the binary fails', async () => {
        const execFile = vi.fn(async () => {
            throw new Error('ENOENT');
        });
        expect(await readMameVersion('/opt/mame/mame', execFile)).toBe(UNKNOWN_MAME_VERSION);
    });
});
