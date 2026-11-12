import {MAUI_KEYS, LONG_PRESS_MS} from './MauiControls';

/**
 * MAUI's actions on the list of games and how each is triggered (the BO's MAUI > Controls tab, one
 * card per action, kept in maui-controls.json with the rest of the controls): its controls
 * pressed, held a while (HOLD_DELAY_MS, then holdMs with a loader), or together with a second key,
 * at once or held a while.
 *
 * Confirm, Scores / back and New player are MAUI keys: their controls are the inputs bound to the
 * key (MauiControlBindings.ts), which the other screens read too (player creation, the vote), and
 * their trigger only counts on the list of games. The other actions have controls of their own
 * (`inputs`), each a single input (a mauiInputId(), "button|8|standard"), shared with another
 * action as long as their triggers differ. A second key is a single input too: no action is set
 * through another one's controls.
 *
 * The settings are turned into hotkeys (compileHotkeys()) for the HotkeyEngine below: a key taking
 * part in a held or two-key hotkey still does its own job, a little later - once released, or once
 * it is clear no hotkey is coming (COMBO_WINDOW_MS) - never when its hotkey went off. The other keys
 * act at once. Electron-free, so it stays unit-testable.
 */

export const ACTION_IDS = ['confirm', 'scores', 'newPlayer', 'backOffice', 'quit', 'shutdown', 'vote', 'star'] as const;
export type ActionId = typeof ACTION_IDS[number];
// What a hotkey triggers: one of the actions.
export type HotkeyAction = ActionId;

/** The actions that are MAUI keys, and which. */
export const KEYED_ACTIONS: Partial<Record<ActionId, string>> = {
    confirm: MAUI_KEYS.enter,
    scores: MAUI_KEYS.space,
    newPlayer: MAUI_KEYS.p,
};

export const ACTION_LABELS: Record<ActionId, string> = {
    confirm: 'Launch the selected game',
    scores: 'Show / hide the game scores',
    newPlayer: 'Create a new player',
    backOffice: 'Show the back office address',
    quit: 'Quit MAUI',
    shutdown: 'Shut the cabinet down (dedicated cabinet only)',
    vote: 'Vote on the selected game',
    star: 'Add the selected game to "My favourites", or take it out',
};

// What the front shows while an action is held (a loader filling up until it goes off).
export const HOTKEY_HOLD_TITLES: Record<ActionId, string> = {
    confirm: 'Launch ?',
    scores: 'Scores ?',
    newPlayer: 'Add new player ?',
    backOffice: 'Back office ?',
    quit: 'Quit MAUI ?',
    shutdown: 'Shut down ?',
    vote: 'Vote ?',
    star: 'My favourites ?',
};

export interface ActionSetting {
    // The action's own controls (not for a MAUI key's action: its inputs are the key's).
    inputs: string[];
    // 0: pressed (or both keys at once); else held this long.
    holdMs: number;
    // A second key (a mauiInputId()), pressed with one of the controls.
    with?: string;
}

export type ActionSettings = Record<ActionId, ActionSetting>;

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

/**
 * The BO's "back to MAUI's default": the MAUI keys' actions as they always were, the others on a
 * keyboard key of their own (held a while for those that end the session), until the BO gives them
 * their cabinet's buttons.
 */
export function defaultActions(): ActionSettings {
    return {
        confirm: {inputs: [], holdMs: 0},
        scores: {inputs: [], holdMs: 0},
        newPlayer: {inputs: [], holdMs: LONG_PRESS_MS.newPlayer},
        backOffice: {inputs: ['key|KeyB'], holdMs: 0},
        quit: {inputs: ['key|Escape'], holdMs: LONG_PRESS_MS.quit},
        shutdown: {inputs: ['key|KeyO'], holdMs: LONG_PRESS_MS.shutdown},
        vote: {inputs: ['key|KeyV'], holdMs: 0},
        star: {inputs: ['key|KeyF'], holdMs: 0},
    };
}

/** The keys that trigger the action (with its second key, if any): its MAUI key, or its own controls. */
export function actionKeys(action: ActionId, setting: ActionSetting): string[] {
    const key = KEYED_ACTIONS[action];
    return key ? [MAUI_KEY_REF + key] : setting.inputs;
}

/** The action does its job as soon as its controls are pressed: no hold, no second key. */
export function isPressOnly(setting: ActionSetting): boolean {
    return setting.holdMs === 0 && !setting.with;
}

/**
 * The hotkeys the engine needs: one per control of each action, except the MAUI keys' actions
 * pressed alone, which are their key's own job.
 */
export function compileHotkeys(actions: ActionSettings): Hotkey[] {
    return ACTION_IDS.flatMap((action) => {
        const setting = actions[action];
        if (KEYED_ACTIONS[action] && isPressOnly(setting)) {
            return [];
        }
        return actionKeys(action, setting).map(key => ({
            action, keys: setting.with ? [key, setting.with] : [key], holdMs: setting.holdMs,
        }));
    });
}

function parseHoldMs(value: unknown): number | null {
    return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= MAX_HOLD_MS ? value : null;
}

/** An action's setting from an untrusted value, null when it is not one. `isKey` tells a valid input (a mauiInputId()). */
export function parseActionSetting(action: ActionId, value: unknown, isKey: (key: string) => boolean): ActionSetting | null {
    if (typeof value !== 'object' || value === null) {
        return null;
    }
    const {inputs, holdMs, with: second} = value as Record<string, unknown>;
    const hold = parseHoldMs(holdMs);
    if (hold === null) {
        return null;
    }
    const own = KEYED_ACTIONS[action] || !Array.isArray(inputs)
        ? []
        : [...new Set(inputs.filter((input): input is string => typeof input === 'string' && isKey(input)))];
    const setting: ActionSetting = {inputs: own, holdMs: hold};
    if (typeof second === 'string' && isKey(second) && !actionKeys(action, setting).includes(second)) {
        setting.with = second;
    }
    return setting;
}

/**
 * The actions of maui-controls.json: `actions` (version 2), else the hotkeys list of version 1
 * (each action's first hotkey on single inputs), else MAUI's defaults. An action missing or
 * unreadable gets its default.
 */
export function parseActions(file: Record<string, unknown>, isKey: (key: string) => boolean): ActionSettings {
    const actions = defaultActions();
    if (typeof file.actions === 'object' && file.actions !== null) {
        const stored = file.actions as Record<string, unknown>;
        for (const action of ACTION_IDS) {
            const setting = parseActionSetting(action, stored[action], isKey);
            if (setting) {
                actions[action] = setting;
            }
        }
        return actions;
    }
    if (!Array.isArray(file.hotkeys)) {
        return actions;
    }
    // Version 1: the hotkeys of the actions that are not MAUI keys, made of single inputs only
    // (those set through a MAUI key are dropped: the BO sets them again on real controls).
    const seen = new Set<string>();
    for (const value of file.hotkeys as unknown[]) {
        const {action, keys, holdMs} = (typeof value === 'object' && value !== null ? value : {}) as Record<string, unknown>;
        const hold = parseHoldMs(holdMs);
        if (!ACTION_IDS.includes(action as ActionId) || KEYED_ACTIONS[action as ActionId] || seen.has(action as string)
            || hold === null || !Array.isArray(keys) || keys.length < 1 || keys.length > 2
            || !keys.every(key => typeof key === 'string' && isKey(key))) {
            continue;
        }
        const [first, second] = keys as string[];
        seen.add(action as string);
        actions[action as ActionId] = {inputs: [first], holdMs: hold, ...(second && second !== first ? {with: second} : {})};
    }
    return actions;
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
