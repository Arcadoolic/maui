import {describe, it, expect, vi, beforeEach, afterEach} from 'vitest';
import {IdleWatch} from '@/class/IdleWatch';

describe('IdleWatch', () => {
    let changes: boolean[];
    const watch = (delayMs = 1000) => new IdleWatch(delayMs, idle => changes.push(idle));

    beforeEach(() => {
        vi.useFakeTimers();
        changes = [];
    });
    afterEach(() => vi.useRealTimers());

    it('turns idle after the delay without activity, and not before it is started', () => {
        const idle = watch();
        vi.advanceTimersByTime(5000);
        expect(changes).toEqual([]);

        idle.start();
        vi.advanceTimersByTime(999);
        expect(changes).toEqual([]);
        vi.advanceTimersByTime(1);
        expect(changes).toEqual([true]);
    });

    it('starts the delay again at each key', () => {
        const idle = watch();
        idle.start();
        vi.advanceTimersByTime(900);
        expect(idle.activity()).toBe(false);
        vi.advanceTimersByTime(900);
        expect(changes).toEqual([]);
        vi.advanceTimersByTime(100);
        expect(changes).toEqual([true]);
    });

    it('tells the key that wakes it up apart, then waits for the delay again', () => {
        const idle = watch();
        idle.start();
        vi.advanceTimersByTime(1000);
        expect(idle.activity()).toBe(true);
        expect(changes).toEqual([true, false]);
        expect(idle.activity()).toBe(false);
        vi.advanceTimersByTime(1000);
        expect(changes).toEqual([true, false, true]);
    });

    it('is never idle while blocked, and counts from the moment it no longer is', () => {
        const idle = watch();
        idle.start();
        idle.block(true);
        vi.advanceTimersByTime(10_000);
        expect(changes).toEqual([]);
        // A key during a game is no wake-up.
        expect(idle.activity()).toBe(false);

        idle.block(false);
        vi.advanceTimersByTime(999);
        expect(changes).toEqual([]);
        vi.advanceTimersByTime(1);
        expect(changes).toEqual([true]);
    });

    it('wakes up when something blocks it', () => {
        const idle = watch();
        idle.start();
        vi.advanceTimersByTime(1000);
        idle.block(true);
        expect(changes).toEqual([true, false]);
    });

    it('never turns idle with a delay of 0, nor once stopped', () => {
        const never = watch(0);
        never.start();
        vi.advanceTimersByTime(3_600_000);
        expect(changes).toEqual([]);

        const idle = watch();
        idle.start();
        idle.stop();
        vi.advanceTimersByTime(5000);
        expect(changes).toEqual([]);
    });

    describe('sleep', () => {
        let sleeps: boolean[];
        const sleepy = (delayMs = 1000, sleepMs = 5000) => new IdleWatch(delayMs, idle => changes.push(idle), {
            delayMs: sleepMs, onChange: asleep => sleeps.push(asleep),
        });

        beforeEach(() => {
            sleeps = [];
        });

        it('falls asleep once idle for the sleep delay', () => {
            const idle = sleepy();
            idle.start();
            vi.advanceTimersByTime(1000 + 4999);
            expect(sleeps).toEqual([]);
            vi.advanceTimersByTime(1);
            expect(changes).toEqual([true]);
            expect(sleeps).toEqual([true]);
        });

        it('tells the key that wakes it from sleep apart, and starts both delays again', () => {
            const idle = sleepy();
            idle.start();
            vi.advanceTimersByTime(6000);
            expect(idle.activity()).toBe(true);
            expect(sleeps).toEqual([true, false]);
            expect(changes).toEqual([true, false]);
            vi.advanceTimersByTime(1000);
            expect(changes).toEqual([true, false, true]);
            expect(sleeps).toEqual([true, false]);
        });

        it('falls asleep from the last key when the front never turns idle', () => {
            const idle = sleepy(0, 5000);
            idle.start();
            vi.advanceTimersByTime(5000);
            expect(changes).toEqual([]);
            expect(sleeps).toEqual([true]);
            expect(idle.activity()).toBe(true);
            expect(sleeps).toEqual([true, false]);
        });

        it('never falls asleep with a sleep delay of 0, nor while blocked', () => {
            const never = sleepy(1000, 0);
            never.start();
            vi.advanceTimersByTime(3_600_000);
            expect(changes).toEqual([true]);
            expect(sleeps).toEqual([]);

            const idle = sleepy();
            idle.start();
            vi.advanceTimersByTime(6000);
            idle.block(true);
            expect(sleeps).toEqual([true, false]);
            vi.advanceTimersByTime(3_600_000);
            expect(sleeps).toEqual([true, false]);
        });
    });
});
