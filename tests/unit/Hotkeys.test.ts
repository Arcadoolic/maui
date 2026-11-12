import {describe, it, expect} from 'vitest';
import {
    COMBO_WINDOW_MS, compileHotkeys, defaultActions, HOLD_DELAY_MS, HotkeyEngine, parseActions, type ActionSettings,
    type Hotkey, type KeyPress,
} from '@/class/Hotkeys';

// The hotkeys MAUI had before its actions (Scores held quits, both held show the BO): the engine
// still has to run any such set.
const defaultHotkeys = (): Hotkey[] => [
    {action: 'newPlayer', keys: ['maui|KeyP'], holdMs: 2000},
    {action: 'ranking', keys: ['maui|Space', 'maui|KeyP'], holdMs: 2000},
    {action: 'quit', keys: ['maui|Space'], holdMs: 3000},
];

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
        timers.advance(HOLD_DELAY_MS + 500);
        hotkeyEngine.release(space);
        expect(log).toEqual(['hold quit', 'hold end', 'down Space', 'up Space']);
    });

    it('shows no hold for a plain press of a key with a held hotkey', () => {
        const {hotkeyEngine, log, timers} = engine(defaultHotkeys());
        hotkeyEngine.press(space);
        timers.advance(HOLD_DELAY_MS - 1);
        hotkeyEngine.release(space);
        timers.advance(5000);
        expect(log).toEqual(['down Space', 'up Space']);
    });

    it('fires a held hotkey once its time is up, and the key does nothing else', () => {
        const {hotkeyEngine, log, timers} = engine(defaultHotkeys());
        hotkeyEngine.press(space);
        timers.advance(HOLD_DELAY_MS + 3000 - 1);
        expect(log).toEqual(['hold quit']);
        timers.advance(1);
        hotkeyEngine.release(space);
        expect(log).toEqual(['hold quit', 'hold end', 'action quit']);
    });

    it('lets two keys together take over the held key of the first', () => {
        const {hotkeyEngine, log, timers} = engine(defaultHotkeys());
        hotkeyEngine.press(space);
        timers.advance(HOLD_DELAY_MS + 300);
        hotkeyEngine.press(p);
        timers.advance(2000);
        hotkeyEngine.release(p);
        hotkeyEngine.release(space);
        expect(log).toEqual(['hold quit', 'hold end', 'hold ranking', 'hold end', 'action ranking']);
    });

    it('ignores the repeats of a keyboard key held down', () => {
        const {hotkeyEngine, log, timers} = engine(defaultHotkeys());
        hotkeyEngine.press(p);
        hotkeyEngine.press(p);
        timers.advance(HOLD_DELAY_MS + 2000);
        expect(log).toEqual(['hold newPlayer', 'hold end', 'action newPlayer']);
    });

    it('matches a MAUI key whatever input produces it', () => {
        const {hotkeyEngine, log, timers} = engine(defaultHotkeys());
        hotkeyEngine.press({key: 'Space', input: 'button|3|standard'});
        timers.advance(HOLD_DELAY_MS + 3000);
        expect(log).toContain('action quit');
    });
});

describe('HotkeyEngine with single inputs', () => {
    it('fires a one-key hotkey at once', () => {
        const {hotkeyEngine, log} = engine([{action: 'ranking', keys: [select.input], holdMs: 0}]);
        hotkeyEngine.press(select);
        hotkeyEngine.release(select);
        expect(log).toEqual(['action ranking']);
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
        timers.advance(HOLD_DELAY_MS);
        hotkeyEngine.reset();
        timers.advance(5000);
        hotkeyEngine.release(space);
        expect(log).toEqual(['hold quit', 'hold end']);
    });
});

const MAUI_ENTER = 'maui|Enter';

describe('compileHotkeys', () => {
    it('gives New player held and the other actions their keyboard keys by default', () => {
        expect(compileHotkeys(defaultActions())).toEqual([
            {action: 'newPlayer', keys: ['maui|KeyP'], holdMs: 2000},
            {action: 'ranking', keys: ['key|KeyB'], holdMs: 0},
            {action: 'quit', keys: ['key|Escape'], holdMs: 3000},
            {action: 'shutdown', keys: ['key|KeyO'], holdMs: 3000},
            {action: 'vote', keys: ['key|KeyV'], holdMs: 0},
            {action: 'star', keys: ['key|KeyF'], holdMs: 0},
        ]);
    });

    it('makes a hotkey of a MAUI key held, and the key alone does nothing on its own', () => {
        const actions: ActionSettings = {...defaultActions(), scores: {inputs: [], holdMs: 2000}};
        const {hotkeyEngine, log, timers} = engine(compileHotkeys(actions));
        hotkeyEngine.press(space);
        timers.advance(HOLD_DELAY_MS + 2000);
        hotkeyEngine.release(space);
        // Home.vue's own job for Space is gated on isKeyPressOnly(): the hotkey shows the scores.
        expect(log).toEqual(['hold scores', 'hold end', 'action scores']);
    });

    it('makes a two-key hotkey of a MAUI key with a second key', () => {
        const actions: ActionSettings = {...defaultActions(), confirm: {inputs: [], holdMs: 0, with: start.input}};
        const {hotkeyEngine, log} = engine(compileHotkeys(actions));
        hotkeyEngine.press(enter);
        hotkeyEngine.press(start);
        expect(log).toEqual(['action confirm']);
    });

    it('fires an action pressed on its own controls, one hotkey per control', () => {
        const actions: ActionSettings = {...defaultActions(), vote: {inputs: [select.input, 'key|KeyV'], holdMs: 0}};
        const hotkeys = compileHotkeys(actions).filter(hotkey => hotkey.action === 'vote');
        expect(hotkeys).toEqual([
            {action: 'vote', keys: [select.input], holdMs: 0},
            {action: 'vote', keys: ['key|KeyV'], holdMs: 0},
        ]);
        const {hotkeyEngine, log} = engine(hotkeys);
        hotkeyEngine.press(select);
        expect(log).toEqual(['action vote']);
    });
});

describe('parseActions', () => {
    const isKey = (key: string) => key.startsWith('button|') || key.startsWith('key|');

    it('reads version 2, and gives an action missing or unreadable its default', () => {
        const actions = parseActions({actions: {
            star: {inputs: ['button|5|standard', 'maui|Space', 'nope', 'button|5|standard'], holdMs: 1000, with: 'button|9|standard'},
            vote: {inputs: ['button|4|standard'], holdMs: 0, with: 'maui|Enter'},
            quit: {inputs: ['button|1|standard'], holdMs: -1},
            newPlayer: {inputs: ['button|1|standard'], holdMs: 0},
        }}, isKey);
        // Another action's controls are never an action's: only single inputs are kept.
        expect(actions.star).toEqual({inputs: ['button|5|standard'], holdMs: 1000, with: 'button|9|standard'});
        expect(actions.vote).toEqual({inputs: ['button|4|standard'], holdMs: 0});
        expect(actions.quit).toEqual(defaultActions().quit);
        // A MAUI key's action has no controls of its own.
        expect(actions.newPlayer).toEqual({inputs: [], holdMs: 0});
        expect(actions.ranking).toEqual(defaultActions().ranking);
    });

    it('drops a second key that is one of the controls', () => {
        expect(parseActions({actions: {vote: {inputs: ['button|4|standard'], holdMs: 0, with: 'button|4|standard'}}}, isKey).vote)
            .toEqual({inputs: ['button|4|standard'], holdMs: 0});
    });

    it('keeps the hotkeys of version 1 made of single inputs only, the first of each action', () => {
        const actions = parseActions({hotkeys: [
            {action: 'quit', keys: ['button|9|standard', 'maui|Space'], holdMs: 0},
            {action: 'quit', keys: ['button|9|standard', 'button|8|standard'], holdMs: 1000},
            {action: 'quit', keys: ['button|3|standard'], holdMs: 0},
            // Back office was an action of its own, replaced by the hiscores board.
            {action: 'backOffice', keys: ['button|2|standard'], holdMs: 0},
            {action: 'newPlayer', keys: ['maui|KeyP'], holdMs: 3000},
            {action: 'reboot', keys: ['button|1|standard'], holdMs: 0},
        ]}, isKey);
        expect(actions.quit).toEqual({inputs: ['button|9|standard'], holdMs: 1000, with: 'button|8|standard'});
        expect(actions.ranking).toEqual(defaultActions().ranking);
        expect(actions.newPlayer).toEqual(defaultActions().newPlayer);
    });

    it('gives MAUI\'s defaults to a file without actions nor hotkeys', () => {
        expect(parseActions({}, isKey)).toEqual(defaultActions());
    });
});
