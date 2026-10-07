import {describe, it, expect} from 'vitest';
import {EventEmitter} from 'events';
import type {IncomingMessage, ServerResponse} from 'http';
import {BoOnDemand, type BoApp} from '@/class/BoOnDemand';

const MINUTE = 60 * 1000;

class FakeResponse extends EventEmitter {
    public statusCode = 200;
    public body = '';

    public setHeader(): void {
        // Not looked at.
    }

    public end(body = ''): void {
        this.body = body;
        this.emit('close');
    }
}

function setup(options: {idleMinutes?: number; fail?: boolean} = {}) {
    const state = {now: 0, loads: 0, disposed: 0, busy: false, handled: [] as FakeResponse[], idleMinutes: options.idleMinutes ?? 15};
    const bo = new BoOnDemand({
        load: async (): Promise<BoApp> => {
            state.loads++;
            if (options.fail) {
                throw new Error('cannot load');
            }
            return {
                handler: (_req, res) => {
                    state.handled.push(res as unknown as FakeResponse);
                },
                isBusy: () => state.busy,
                dispose: () => {
                    state.disposed++;
                },
            };
        },
        idleMs: () => state.idleMinutes * MINUTE,
        now: () => state.now,
    });
    const request = async (): Promise<FakeResponse> => {
        const res = new FakeResponse();
        await bo.handle({} as IncomingMessage, res as unknown as ServerResponse);
        return res;
    };
    return {bo, state, request};
}

describe('BoOnDemand', () => {
    it('is not loaded before its first request, which loads it and is handed over', async () => {
        const {bo, state, request} = setup();
        expect(bo.isLoaded()).toBe(false);
        expect(state.loads).toBe(0);

        const res = await request();

        expect(bo.isLoaded()).toBe(true);
        expect(state.handled).toEqual([res]);
    });

    it('loads once for requests arriving together, and once for those that follow', async () => {
        const {state, request} = setup();
        await Promise.all([request(), request(), request()]);
        await request();
        expect(state.loads).toBe(1);
        expect(state.handled).toHaveLength(4);
    });

    it('answers 503 when it cannot be loaded, and tries again at the next request', async () => {
        const {bo, state, request} = setup({fail: true});
        const res = await request();
        expect(res.statusCode).toBe(503);
        expect(bo.isLoaded()).toBe(false);
        await request();
        expect(state.loads).toBe(2);
    });

    it('is dropped once idle for the delay, counted from the end of the last answer', async () => {
        const {bo, state, request} = setup();
        const res = await request();
        state.now = 10 * MINUTE;
        res.end();

        state.now = 24 * MINUTE;
        expect(bo.check()).toBe(false);
        state.now = 25 * MINUTE;
        expect(bo.check()).toBe(true);
        expect(state.disposed).toBe(1);
        expect(bo.isLoaded()).toBe(false);

        // Its next request loads it again.
        await request();
        expect(state.loads).toBe(2);
    });

    it('is kept while a request is still being answered', async () => {
        const {bo, state, request} = setup();
        await request();
        state.now = 60 * MINUTE;
        expect(bo.check()).toBe(false);
        expect(state.disposed).toBe(0);
    });

    it('is kept while the BO says it is busy', async () => {
        const {bo, state, request} = setup();
        (await request()).end();
        state.busy = true;
        state.now = 60 * MINUTE;
        expect(bo.check()).toBe(false);
        state.busy = false;
        expect(bo.check()).toBe(true);
    });

    it('is kept for good with a delay of 0', async () => {
        const {bo, state, request} = setup({idleMinutes: 0});
        (await request()).end();
        state.now = 24 * 60 * MINUTE;
        expect(bo.check()).toBe(false);
    });

    it('wake() loads it without a request, and counts as activity', async () => {
        const {bo, state} = setup();
        state.now = 100 * MINUTE;
        await bo.wake();
        expect(bo.isLoaded()).toBe(true);
        state.now = 114 * MINUTE;
        expect(bo.check()).toBe(false);
        state.now = 115 * MINUTE;
        expect(bo.check()).toBe(true);
    });
});
