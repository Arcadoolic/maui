import {describe, it, expect} from 'vitest';
import {
    COMBO_WINDOW_MS, defaultHotkeys, HotkeyEngine, parseHotkey, sameHotkey, type Hotkey, type KeyPress,
} from '@/class/Hotkeys';

// Timers driven by hand: advance(ms) runs what is due.
function fakeTimers() {
    let now = 0;
    let next = 0;
    const due = new Map<number, {at: number; callback: () => void}>();
    return {
        set: (callback: () => void, ms: number) => {
            const id = ++next;
            due.set(id, {at: now + ms, callback});
            return id;
        },
        clear: (handle: unknown) => void due.delete(handle as number),
        advance(ms: number) {
            const until = now + ms;
            for (;;) {
                const [id, timer] = [...due.entries()].filter(([, t]) => t.at <= until).sort((a, b) => a[1].at - b[1].at)[0] ?? [];
                if (id === undefined || !timer) {
                    break;
                }
                due.delete(id);
                now = timer.at;
                timer.callback();
            }
            now = until;
        },
    };
}

function engine(hotkeys: Hotkey[]) {
    const log: string[] = [];
    const timers = fakeTimers();
    const hotkeyEngine = new HotkeyEngine(hotkeys, {
        keyDown: key => log.push(`down ${key}`),
        keyUp: key => log.push(`up ${key}`),
        action: action => log.push(`action ${action}`),
        holdStart: hotkey => log.push(`hold ${hotkey.action}`),
        holdEnd: () => log.push('hold end'),
    }, timers);
    return {hotkeyEngine, log, timers};
}

const space: KeyPress = {key: 'Space', input: 'key|Space'};
const p: KeyPress = {key: 'KeyP', input: 'key|KeyP'};
const enter: KeyPress = {key: 'Enter', input: 'key|Enter'};
const select: KeyPress = {key: '', input: 'button|8|standard'};
const start: KeyPress = {key: '', input: 'button|9|standard'};

describe('HotkeyEngine with the default hotkeys', () => {
    it('lets a key no hotkey uses act at once', () => {
        const {hotkeyEngine, log} = engine(defaultHotkeys());
        hotkeyEngine.press(enter);
        hotkeyEngine.release(enter);
        expect(log).toEqual(['down Enter', 'up Enter']);
    });

    it('gives a held key its own job on release when released early', () => {
        const {hotkeyEngine, log, timers} = engine(defaultHotkeys());
        hotkeyEngine.press(space);
        timers.advance(500);
        hotkeyEngine.release(space);
        expect(log).toEqual(['hold quit', 'hold end', 'down Space', 'up Space']);
    });

    it('fires a held hotkey once its time is up, and the key does nothing else', () => {
        const {hotkeyEngine, log, timers} = engine(defaultHotkeys());
        hotkeyEngine.press(space);
        timers.advance(3000);
        hotkeyEngine.release(space);
        expect(log).toEqual(['hold quit', 'hold end', 'action quit']);
    });

    it('lets two keys together take over the held key of the first', () => {
        const {hotkeyEngine, log, timers} = engine(defaultHotkeys());
        hotkeyEngine.press(space);
        timers.advance(300);
        hotkeyEngine.press(p);
        timers.advance(2000);
        hotkeyEngine.release(p);
        hotkeyEngine.release(space);
        expect(log).toEqual(['hold quit', 'hold end', 'hold backOffice', 'hold end', 'action backOffice']);
    });

    it('ignores the repeats of a keyboard key held down', () => {
        const {hotkeyEngine, log, timers} = engine(defaultHotkeys());
        hotkeyEngine.press(p);
        hotkeyEngine.press(p);
        timers.advance(2000);
        expect(log).toEqual(['hold newPlayer', 'hold end', 'action newPlayer']);
    });

    it('matches a MAUI key whatever input produces it', () => {
        const {hotkeyEngine, log, timers} = engine(defaultHotkeys());
        hotkeyEngine.press({key: 'Space', input: 'button|3|standard'});
        timers.advance(3000);
        expect(log).toContain('action quit');
    });
});

describe('HotkeyEngine with single inputs', () => {
    it('fires a one-key hotkey at once', () => {
        const {hotkeyEngine, log} = engine([{action: 'backOffice', keys: [select.input], holdMs: 0}]);
        hotkeyEngine.press(select);
        hotkeyEngine.release(select);
        expect(log).toEqual(['action backOffice']);
    });

    it('fires a two-key hotkey pressed together, and neither key acts', () => {
        const {hotkeyEngine, log, timers} = engine([{action: 'quit', keys: [select.input, MAUI_ENTER], holdMs: 0}]);
        hotkeyEngine.press(enter);
        timers.advance(100);
        hotkeyEngine.press(select);
        hotkeyEngine.release(select);
        hotkeyEngine.release(enter);
        expect(log).toEqual(['action quit']);
    });

    it('lets a key of a two-key hotkey act once the other one did not come', () => {
        const {hotkeyEngine, log, timers} = engine([{action: 'quit', keys: [start.input, MAUI_ENTER], holdMs: 0}]);
        hotkeyEngine.press(enter);
        timers.advance(COMBO_WINDOW_MS);
        hotkeyEngine.press(start);
        hotkeyEngine.release(start);
        hotkeyEngine.release(enter);
        // Enter launched its game: Start coming late completes nothing.
        expect(log).toEqual(['down Enter', 'down ', 'up ', 'up Enter']);
    });

    it('forgets everything on reset', () => {
        const {hotkeyEngine, log, timers} = engine(defaultHotkeys());
        hotkeyEngine.press(space);
        hotkeyEngine.reset();
        timers.advance(5000);
        hotkeyEngine.release(space);
        expect(log).toEqual(['hold quit', 'hold end']);
    });
});

const MAUI_ENTER = 'maui|Enter';

describe('parseHotkey', () => {
    const isKey = (key: string) => key.startsWith('maui|') || key.startsWith('button|');

    it('reads a valid hotkey', () => {
        expect(parseHotkey({action: 'quit', keys: ['maui|Space'], holdMs: 3000}, isKey))
            .toEqual({action: 'quit', keys: ['maui|Space'], holdMs: 3000});
    });

    it('refuses an unknown action, a bad key, twice the same key, three keys or a wrong hold', () => {
        expect(parseHotkey({action: 'reboot', keys: ['maui|Space'], holdMs: 0}, isKey)).toBeNull();
        expect(parseHotkey({action: 'quit', keys: ['nope'], holdMs: 0}, isKey)).toBeNull();
        expect(parseHotkey({action: 'quit', keys: ['maui|Space', 'maui|Space'], holdMs: 0}, isKey)).toBeNull();
        expect(parseHotkey({action: 'quit', keys: ['maui|Space', 'maui|KeyP', 'maui|Enter'], holdMs: 0}, isKey)).toBeNull();
        expect(parseHotkey({action: 'quit', keys: ['maui|Space'], holdMs: -1}, isKey)).toBeNull();
        expect(parseHotkey({action: 'quit', keys: ['maui|Space'], holdMs: 1.5}, isKey)).toBeNull();
        expect(parseHotkey({action: 'quit', keys: ['maui|Space'], holdMs: 60_000}, isKey)).toBeNull();
        expect(parseHotkey(null, isKey)).toBeNull();
    });

    it('tells the same hotkey whatever the order of its keys', () => {
        expect(sameHotkey(
            {action: 'quit', keys: ['maui|Space', 'maui|KeyP'], holdMs: 0},
            {action: 'quit', keys: ['maui|KeyP', 'maui|Space'], holdMs: 0},
        )).toBe(true);
    });
});
