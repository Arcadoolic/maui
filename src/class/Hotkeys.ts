import {MAUI_KEYS, LONG_PRESS_MS} from './MauiControls';

/**
 * MAUI's hotkeys (the BO's MAUI > Controls tab, kept in maui-controls.json with the rest of the
 * controls): an action of the front triggered by
 * - one key, pressed (a cabinet's own button for it),
 * - one key held a while (HOLD_DELAY_MS, then holdMs with a loader),
 * - two keys together, at once or held a while.
 * A key is either one of MAUI's keys, whatever produces it ("maui|Space": every input bound to
 * Scores / back), or a single input, MAUI key or not ("button|8|standard", a mauiInputId()): a
 * cabinet's Start + Select, for instance, which do nothing else in MAUI.
 *
 * A key taking part in a held or two-key hotkey still does its own job, a little later: once
 * released, or once it is clear no hotkey is coming (COMBO_WINDOW_MS) - never when its hotkey
 * went off. The other keys act at once, as before. Electron-free, so it stays unit-testable.
 */

export const HOTKEY_ACTIONS = ['backOffice', 'quit', 'newPlayer', 'shutdown'] as const;
export type HotkeyAction = typeof HOTKEY_ACTIONS[number];

export const HOTKEY_ACTION_LABELS: Record<HotkeyAction, string> = {
    backOffice: 'Show the back office address',
    quit: 'Quit MAUI',
    newPlayer: 'Create a new player',
    shutdown: 'Shut the cabinet down (dedicated cabinet only)',
};

// What the front shows while a hotkey is held (a loader filling up until it goes off).
export const HOTKEY_HOLD_TITLES: Record<HotkeyAction, string> = {
    backOffice: 'Back office ?',
    quit: 'Quit MAUI ?',
    newPlayer: 'Add new player ?',
    shutdown: 'Shut down ?',
};

export interface Hotkey {
    action: HotkeyAction;
    // One or two keys: "maui|<MAUI key>" or a mauiInputId().
    keys: string[];
    // 0: as soon as the keys are down.
    holdMs: number;
}

export const MAUI_KEY_REF = 'maui|';
export const MAX_HOLD_MS = 10_000;
// How long a key of a two-key hotkey waits for the other one before doing its own job.
export const COMBO_WINDOW_MS = 250;
// How long a key with a held hotkey of its own is down before that hold starts (its loader shows,
// then fills for holdMs): a plain press of the key never flashes it.
export const HOLD_DELAY_MS = 1000;

/** MAUI's hotkeys before the BO changed anything: what the front always did. */
export function defaultHotkeys(): Hotkey[] {
    return [
        {action: 'backOffice', keys: [MAUI_KEY_REF + MAUI_KEYS.space, MAUI_KEY_REF + MAUI_KEYS.p], holdMs: LONG_PRESS_MS.backOffice},
        {action: 'quit', keys: [MAUI_KEY_REF + MAUI_KEYS.space], holdMs: LONG_PRESS_MS.quit},
        {action: 'newPlayer', keys: [MAUI_KEY_REF + MAUI_KEYS.p], holdMs: LONG_PRESS_MS.newPlayer},
    ];
}

/**
 * A hotkey from an untrusted value (maui-controls.json edited by hand, a BO form), null when it is
 * not one. `isKey` tells a valid key reference.
 */
export function parseHotkey(value: unknown, isKey: (key: string) => boolean): Hotkey | null {
    if (typeof value !== 'object' || value === null) {
        return null;
    }
    const {action, keys, holdMs} = value as Record<string, unknown>;
    if (!HOTKEY_ACTIONS.includes(action as HotkeyAction) || !Array.isArray(keys)
        || keys.length < 1 || keys.length > 2 || !keys.every(key => typeof key === 'string' && isKey(key))
        || new Set(keys).size !== keys.length) {
        return null;
    }
    if (typeof holdMs !== 'number' || !Number.isInteger(holdMs) || holdMs < 0 || holdMs > MAX_HOLD_MS) {
        return null;
    }
    return {action: action as HotkeyAction, keys: [...keys] as string[], holdMs};
}

/** The same hotkey: same action, same keys in any order, same hold. */
export function sameHotkey(a: Hotkey, b: Hotkey): boolean {
    return a.action === b.action && a.holdMs === b.holdMs
        && [...a.keys].sort().join('\n') === [...b.keys].sort().join('\n');
}

/** A press as the front sees it: the MAUI key it produces ('' for none), and the input itself. */
export interface KeyPress {
    key: string;
    // mauiInputId() of the input.
    input: string;
}

export interface HotkeyEngineCallbacks {
    /** A key's own job, now: as a press, then as a release. */
    keyDown(key: string): void;
    keyUp(key: string): void;
    /** A hotkey went off. */
    action(action: HotkeyAction): void;
    /** A held hotkey started (the front shows how long is left) or stopped short of going off. */
    holdStart(hotkey: Hotkey): void;
    holdEnd(): void;
}

type PressState = 'pending' | 'passed' | 'consumed';

interface Timers {
    set(callback: () => void, ms: number): unknown;
    clear(handle: unknown): void;
}

const browserTimers: Timers = {
    set: (callback, ms) => setTimeout(callback, ms),
    clear: handle => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

/** Tells, from the front's presses and releases, which hotkey goes off and when the keys act. */
export class HotkeyEngine {
    private readonly pressed = new Map<string, {press: KeyPress; state: PressState; window?: unknown}>();
    // `started`: its loader is on (holdStart() called), past HOLD_DELAY_MS for a one-key hotkey.
    private holding: {hotkey: Hotkey; inputs: string[]; timer: unknown; started: boolean} | null = null;

    public constructor(
        private hotkeys: Hotkey[],
        private readonly callbacks: HotkeyEngineCallbacks,
        private readonly timers: Timers = browserTimers,
    ) {}

    public setHotkeys(hotkeys: Hotkey[]): void {
        this.reset();
        this.hotkeys = hotkeys;
    }

    public press(press: KeyPress): void {
        // A keyboard key held down repeats its keydown.
        if (this.pressed.has(press.input)) {
            return;
        }
        const involved = this.hotkeys.filter(hotkey => hotkey.keys.some(key => matches(key, press)));
        if (!involved.length) {
            this.pressed.set(press.input, {press, state: 'passed'});
            this.callbacks.keyDown(press.key);
            return;
        }
        const entry: {press: KeyPress; state: PressState; window?: unknown} = {press, state: 'pending'};
        this.pressed.set(press.input, entry);
        const completed = this.completedBy(press);
        if (completed) {
            this.start(completed);
        }
        if (entry.state !== 'pending') {
            return;
        }
        // Held hotkeys of this key alone: its own job waits for its release. Otherwise only
        // two-key hotkeys are waiting for it: their other key has a moment to come.
        const waitsForRelease = involved.some(hotkey => hotkey.keys.length === 1);
        if (!waitsForRelease) {
            entry.window = this.timers.set(() => {
                entry.window = undefined;
                if (entry.state === 'pending' && !this.isHeldBy(press.input)) {
                    entry.state = 'passed';
                    this.callbacks.keyDown(press.key);
                }
            }, COMBO_WINDOW_MS);
        }
    }

    public release(press: KeyPress): void {
        const entry = this.pressed.get(press.input);
        if (!entry) {
            return;
        }
        this.pressed.delete(press.input);
        if (entry.window !== undefined) {
            this.timers.clear(entry.window);
        }
        if (this.isHeldBy(press.input)) {
            this.stopHolding();
        }
        if (entry.state === 'passed') {
            this.callbacks.keyUp(entry.press.key);
        } else if (entry.state === 'pending') {
            this.callbacks.keyDown(entry.press.key);
            this.callbacks.keyUp(entry.press.key);
        }
    }

    /** Forgets every key down (a modal took the keys over, the window lost its focus). */
    public reset(): void {
        this.stopHolding();
        for (const entry of this.pressed.values()) {
            if (entry.window !== undefined) {
                this.timers.clear(entry.window);
            }
        }
        this.pressed.clear();
    }

    /**
     * The hotkey this press completes, with keys still waiting (none acted yet): the one with the
     * most keys, two-key hotkeys winning over one-key ones.
     */
    private completedBy(press: KeyPress): {hotkey: Hotkey; inputs: string[]} | null {
        const waiting = [...this.pressed.values()].filter(entry => entry.state === 'pending').map(entry => entry.press);
        let best: {hotkey: Hotkey; inputs: string[]} | null = null;
        for (const hotkey of this.hotkeys) {
            if (!hotkey.keys.some(key => matches(key, press))) {
                continue;
            }
            const inputs = assign(hotkey.keys, waiting);
            if (inputs && (!best || hotkey.keys.length > best.hotkey.keys.length)) {
                best = {hotkey, inputs};
            }
        }
        return best;
    }

    private start(match: {hotkey: Hotkey; inputs: string[]}): void {
        if (match.hotkey.holdMs <= 0) {
            this.stopHolding();
            this.fire(match.hotkey, match.inputs);
            return;
        }
        // A two-key hotkey takes over the held one-key hotkey of its first key.
        this.stopHolding();
        if (match.hotkey.keys.length > 1) {
            this.startHold(match);
            return;
        }
        const timer = this.timers.set(() => this.startHold(match), HOLD_DELAY_MS);
        this.holding = {...match, timer, started: false};
    }

    private startHold(match: {hotkey: Hotkey; inputs: string[]}): void {
        const timer = this.timers.set(() => {
            this.holding = null;
            this.callbacks.holdEnd();
            this.fire(match.hotkey, match.inputs);
        }, match.hotkey.holdMs);
        this.holding = {...match, timer, started: true};
        this.callbacks.holdStart(match.hotkey);
    }

    private fire(hotkey: Hotkey, inputs: string[]): void {
        for (const input of inputs) {
            const entry = this.pressed.get(input);
            if (entry) {
                entry.state = 'consumed';
                if (entry.window !== undefined) {
                    this.timers.clear(entry.window);
                    entry.window = undefined;
                }
            }
        }
        this.callbacks.action(hotkey.action);
    }

    private isHeldBy(input: string): boolean {
        return this.holding?.inputs.includes(input) ?? false;
    }

    private stopHolding(): void {
        if (!this.holding) {
            return;
        }
        this.timers.clear(this.holding.timer);
        const started = this.holding.started;
        this.holding = null;
        if (started) {
            this.callbacks.holdEnd();
        }
    }
}

function matches(key: string, press: KeyPress): boolean {
    return key === press.input || (press.key !== '' && key === MAUI_KEY_REF + press.key);
}

/** The inputs of `presses` matching `keys` one each, null when they don't all match. */
function assign(keys: string[], presses: KeyPress[]): string[] | null {
    const used: string[] = [];
    for (const key of keys) {
        const found = presses.find(press => !used.includes(press.input) && matches(key, press));
        if (!found) {
            return null;
        }
        used.push(found.input);
    }
    return used;
}
