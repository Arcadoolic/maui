import {describe, it, expect, vi, beforeEach, afterEach} from 'vitest';
import {PlaySession} from '@/class/PlaySession';
import type {TableRow} from '@/class/ScoreDiff';

const row = (rank: number, score: number, name: string): TableRow => ({rank, score, name});

function harness(initial: TableRow[] | null, watched = true) {
    let table = initial;
    let onChange: (() => void) | null = null;
    const stop = vi.fn();
    const report = vi.fn(async (rows: TableRow[]) => { void rows; });
    const session = new PlaySession({
        read: async () => table,
        watch: watched ? callback => { onChange = callback; return stop; } : undefined,
        report,
        debounceMs: 100,
    });
    return {
        session, report, stop,
        write: (rows: TableRow[]) => { table = rows; onChange?.(); },
        set: (rows: TableRow[]) => { table = rows; },
    };
}

describe('PlaySession', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it('reports, as MAME writes the file, only what the game added', async () => {
        const h = harness([row(1, 19200, 'MAF'), row(2, 12900, 'NOB')]);
        await h.session.start();

        h.write([row(1, 19200, 'MAF'), row(2, 15000, 'SKI'), row(3, 12900, 'NOB')]);
        await vi.advanceTimersByTimeAsync(100);

        expect(h.report).toHaveBeenCalledWith([row(2, 15000, 'SKI')]);
    });

    it('waits for the writes to settle, and reports each row once', async () => {
        const h = harness([]);
        await h.session.start();

        h.write([row(1, 100, 'NOB')]);
        h.write([row(1, 100, 'NOB')]);
        await vi.advanceTimersByTimeAsync(100);
        h.write([row(1, 200, 'SKI'), row(2, 100, 'NOB')]);
        await vi.advanceTimersByTimeAsync(100);
        await h.session.end();

        expect(h.report.mock.calls).toEqual([[[row(1, 100, 'NOB')]], [[row(1, 200, 'SKI')]]]);
        expect(h.stop).toHaveBeenCalled();
    });

    it('takes the nameless rows of a first table as the game\'s default scores', async () => {
        const h = harness([]);
        await h.session.start();

        // The first file ever written: the score that beat a default one, among the others.
        h.write([row(1, 12000, ''), row(2, 10000, ''), row(3, 10000, ''), row(4, 9000, 'NOB')]);
        await vi.advanceTimersByTimeAsync(100);
        h.write([row(1, 15300, ''), row(2, 10000, ''), row(3, 10000, ''), row(4, 9000, 'NOB')]);
        await vi.advanceTimersByTimeAsync(100);
        await h.session.end();

        expect(h.report.mock.calls).toEqual([[[row(4, 9000, 'NOB')]], [[row(1, 15300, '')]]]);
    });

    it('still reports the nameless rows a game with a table adds', async () => {
        const h = harness([row(1, 10000, ''), row(2, 10000, '')]);
        await h.session.start();

        h.write([row(1, 12000, ''), row(2, 10000, '')]);
        await vi.advanceTimersByTimeAsync(100);

        expect(h.report).toHaveBeenCalledWith([row(1, 12000, '')]);
    });

    it('reads a game without a watch (nvram) when it ends', async () => {
        const h = harness([row(1, 100, 'NOB')], false);
        await h.session.start();
        h.set([row(1, 300, 'SKI'), row(2, 100, 'NOB')]);

        await h.session.end();

        expect(h.report).toHaveBeenCalledWith([row(1, 300, 'SKI')]);
    });

    it('takes a table missing at the start as empty, and skips an unreadable one', async () => {
        const h = harness(null);
        await h.session.start();
        h.set([row(1, 100, 'NOB')]);
        await h.session.end();
        expect(h.report).toHaveBeenCalledWith([row(1, 100, 'NOB')]);
    });
});
