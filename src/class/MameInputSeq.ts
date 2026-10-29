/**
 * MAME input sequences as MAME itself prints them (input:seq_to_tokens()) and reads them back from
 * default.cfg's <newseq>: whitespace-separated codes, alternatives joined by the `OR` keyword, and
 * `NOT <code>` modifiers, e.g. "KEYCODE_TAB NOT KEYCODE_LALT NOT KEYCODE_RALT OR JOYCODE_1_BUTTON9".
 */

/**
 * Drops every `OR` alternative of `seq` that contains `token`, keeping the rest verbatim. Returns
 * `seq` unchanged if `token` isn't in it, and null if `token` was its only alternative (nothing
 * left to write back - the caller decides what that means).
 */
export function removeTokenFromSeq(seq: string, token: string): string | null {
    const alternatives = seq.trim().split(/\s+OR\s+/);
    const kept = alternatives.filter(alternative => !alternative.split(/\s+/).includes(token));
    if (kept.length === alternatives.length) {
        return seq;
    }
    return kept.length ? kept.join(' OR ') : null;
}

/**
 * Parses capture-daemon.lua's ui-seqs.txt, one `<PORT_TYPE>|<sequence>` line per input port (ports
 * with an empty default sequence are skipped - nothing there to conflict with).
 */
export function parseUiSeqs(content: string): Map<string, string> {
    const seqs = new Map<string, string>();
    for (const line of content.split(/\r?\n/)) {
        const separator = line.indexOf('|');
        if (separator <= 0) {
            continue;
        }
        const seq = line.slice(separator + 1).trim();
        if (seq) {
            seqs.set(line.slice(0, separator), seq);
        }
    }
    return seqs;
}

/**
 * The `OR` alternatives of `seq`, each one what triggers the input on its own (a single code, or a
 * combination like "KEYCODE_F3 KEYCODE_LSHIFT" or "KEYCODE_TAB NOT KEYCODE_LALT"). An empty
 * sequence - written `NONE` in a cfg - has none.
 */
export function seqAlternatives(seq: string): string[] {
    const trimmed = seq.trim();
    if (!trimmed || trimmed === 'NONE') {
        return [];
    }
    return trimmed.split(/\s+OR\s+/).map(alternative => alternative.split(/\s+/).join(' '));
}

/** Back to a sequence as MAME writes it in a cfg: `NONE` when nothing is left. */
export function seqFromAlternatives(alternatives: string[]): string {
    return alternatives.length ? alternatives.join(' OR ') : 'NONE';
}

/** `seq` with `alternative` added at its end, unchanged when it already holds it. */
export function addSeqAlternative(seq: string, alternative: string): string {
    const alternatives = seqAlternatives(seq);
    const added = seqAlternatives(alternative).join(' ');
    return alternatives.includes(added) ? seqFromAlternatives(alternatives) : seqFromAlternatives([...alternatives, added]);
}

/** `seq` without `alternative` (compared whitespace-insensitively), `NONE` if it was the last. */
export function removeSeqAlternative(seq: string, alternative: string): string {
    const removed = seqAlternatives(alternative).join(' ');
    return seqFromAlternatives(seqAlternatives(seq).filter(kept => kept !== removed));
}

export interface InputDefaults {
    // MAME's own standard sequence for every digital input type, before default.cfg.
    seqs: Map<string, string>;
    // The keyboard keys and mouse buttons MAME knows: token -> MAME's name for it ("Escape").
    codes: Map<string, string>;
}

/**
 * Parses input-defaults.lua's stdout, amid MAME's boot chatter (only lines starting with its
 * markers are read): `MAUI_SEQ|<PORT_TYPE>|<sequence>` and `MAUI_CODE|<token>|<name>`.
 */
export function parseInputDefaults(stdout: string): InputDefaults {
    const seqs = new Map<string, string>();
    const codes = new Map<string, string>();
    for (const line of stdout.split(/\r?\n/)) {
        const [marker, key, ...rest] = line.split('|');
        if (!key || !rest.length) {
            continue;
        }
        if (marker === 'MAUI_SEQ') {
            seqs.set(key, rest.join('|').trim());
        } else if (marker === 'MAUI_CODE') {
            codes.set(key, rest.join('|').trim());
        }
    }
    return {seqs, codes};
}

export type InputDeviceKind = 'keyboard' | 'mouse' | 'joystick' | 'lightgun' | 'other';

export function inputCodeKind(token: string): InputDeviceKind {
    if (token.startsWith('KEYCODE_')) {
        return 'keyboard';
    }
    if (token.startsWith('MOUSECODE_')) {
        return 'mouse';
    }
    if (token.startsWith('JOYCODE_')) {
        return 'joystick';
    }
    return token.startsWith('GUNCODE_') ? 'lightgun' : 'other';
}

const KIND_LABELS: Record<InputDeviceKind, string> = {
    keyboard: 'Key',
    mouse: 'Mouse',
    joystick: 'Joy',
    lightgun: 'Gun',
    other: '',
};

/**
 * A readable name for one code: MAME's own key name when `names` has it ("Escape"), else the
 * token cut down ("JOYCODE_1_BUTTON7" -> "Joy 1 Button 7", "MOUSECODE_1_BUTTON1" -> "Mouse 1
 * Button 1").
 */
export function describeInputCode(token: string, names: Map<string, string>): string {
    const name = names.get(token);
    if (name && inputCodeKind(token) === 'keyboard') {
        return name;
    }
    const kind = inputCodeKind(token);
    const capitalize = (word: string) => word.charAt(0) + word.slice(1).toLowerCase();
    const rest = token.replace(/^[A-Z]+CODE_/, '').split('_').map(part => {
        // "BUTTON7" -> "Button 7"
        const numbered = /^([A-Z]+)(\d+)$/.exec(part);
        return numbered ? `${capitalize(numbered[1])} ${numbered[2]}` : capitalize(part);
    }).join(' ');
    return [KIND_LABELS[kind], rest].filter(Boolean).join(' ');
}

/**
 * A readable name for one alternative: its codes joined by "+", and its `NOT` modifiers after
 * "without" ("KEYCODE_F5 NOT KEYCODE_LSHIFT" -> "F5 without Left Shift").
 */
export function describeSeqAlternative(alternative: string, names: Map<string, string>): string {
    const pressed: string[] = [];
    const excluded: string[] = [];
    const parts = alternative.trim().split(/\s+/);
    for (let i = 0; i < parts.length; i++) {
        if (parts[i] === 'NOT' && parts[i + 1]) {
            excluded.push(describeInputCode(parts[++i], names));
        } else {
            pressed.push(describeInputCode(parts[i], names));
        }
    }
    return pressed.join(' + ') + (excluded.length ? ` without ${excluded.join(', ')}` : '');
}

/** The device an alternative is pressed on: its first code's. */
export function seqAlternativeKind(alternative: string): InputDeviceKind {
    return inputCodeKind(alternative.trim().split(/\s+/)[0] ?? '');
}

/**
 * MAME's keyboard token for a browser KeyboardEvent.code, so the BO can take a key pressed in the
 * page itself. Both name the key by its place on a US QWERTY keyboard, not by what is printed on
 * it: "KeyA" / KEYCODE_A is the key right of Tab on a QWERTY and right of Caps Lock on an AZERTY,
 * the same key MAME's SDL input reports (scancodes).
 */
const BROWSER_KEY_TOKENS: Record<string, string> = {
    Escape: 'ESC', Backquote: 'TILDE', Minus: 'MINUS', Equal: 'EQUALS', Backspace: 'BACKSPACE', Tab: 'TAB',
    BracketLeft: 'OPENBRACE', BracketRight: 'CLOSEBRACE', Enter: 'ENTER', Semicolon: 'COLON', Quote: 'QUOTE',
    Backslash: 'BACKSLASH', IntlBackslash: 'BACKSLASH2', Comma: 'COMMA', Period: 'STOP', Slash: 'SLASH',
    Space: 'SPACE', Insert: 'INSERT', Delete: 'DEL', Home: 'HOME', End: 'END', PageUp: 'PGUP', PageDown: 'PGDN',
    ArrowLeft: 'LEFT', ArrowRight: 'RIGHT', ArrowUp: 'UP', ArrowDown: 'DOWN',
    NumpadDivide: 'SLASHPAD', NumpadMultiply: 'ASTERISK', NumpadSubtract: 'MINUSPAD', NumpadAdd: 'PLUSPAD',
    NumpadDecimal: 'DELPAD', NumpadEnter: 'ENTERPAD', NumpadEqual: 'KEYPAD=', NumpadComma: 'KEYPAD,',
    PrintScreen: 'PRTSCR', Pause: 'PAUSE', ShiftLeft: 'LSHIFT', ShiftRight: 'RSHIFT',
    ControlLeft: 'LCONTROL', ControlRight: 'RCONTROL', AltLeft: 'LALT', AltRight: 'RALT',
    ScrollLock: 'SCRLOCK', NumLock: 'NUMLOCK', CapsLock: 'CAPSLOCK', MetaLeft: 'LWIN', MetaRight: 'RWIN',
    ContextMenu: 'MENU',
};

export function browserKeyToken(code: string): string | undefined {
    const letterOrDigit = /^(?:Key([A-Z])|Digit(\d))$/.exec(code);
    if (letterOrDigit) {
        return `KEYCODE_${letterOrDigit[1] ?? letterOrDigit[2]}`;
    }
    const numpadDigit = /^Numpad(\d)$/.exec(code);
    if (numpadDigit) {
        return `KEYCODE_${numpadDigit[1]}PAD`;
    }
    if (/^F(?:[1-9]|1\d|2[0-4])$/.test(code)) {
        return `KEYCODE_${code}`;
    }
    return BROWSER_KEY_TOKENS[code] ? `KEYCODE_${BROWSER_KEY_TOKENS[code]}` : undefined;
}

/**
 * MAME's token for a browser MouseEvent.button (0 left, 1 middle, 2 right, 3 back, 4 forward).
 * MAME numbers them left, middle, right like SDL: its defaults give P1 Button 2 the right button
 * as MOUSECODE_1_BUTTON3.
 */
export function browserMouseToken(button: number): string | undefined {
    const mameButton = [1, 2, 3, 4, 5][button];
    return mameButton ? `MOUSECODE_1_BUTTON${mameButton}` : undefined;
}

/** Every browser code browserKeyToken() knows, with its MAME token: what the BO page is given. */
export function browserKeyTokens(): Record<string, string> {
    const codes = [
        ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map(letter => `Key${letter}`),
        ...'0123456789'.split('').flatMap(digit => [`Digit${digit}`, `Numpad${digit}`]),
        ...Array.from({length: 24}, (_, i) => `F${i + 1}`),
        ...Object.keys(BROWSER_KEY_TOKENS),
    ];
    return Object.fromEntries(codes.map(code => [code, browserKeyToken(code)!]));
}

/**
 * Player 2's port type for one of player 1 and the other way round ("P1_BUTTON1" <-> "P2_BUTTON1",
 * "COIN1" <-> "COIN2", "START1" <-> "START2"), undefined for any other.
 */
export function otherPlayerPortType(portType: string): string | undefined {
    const swap: Record<string, string> = {1: '2', 2: '1'};
    const playerPrefix = /^P([12])_(.+)$/.exec(portType);
    if (playerPrefix) {
        return `P${swap[playerPrefix[1]]}_${playerPrefix[2]}`;
    }
    const numbered = /^(COIN|START)([12])$/.exec(portType);
    return numbered ? `${numbered[1]}${swap[numbered[2]]}` : undefined;
}

function isGamepadAlternative(alternative: string): boolean {
    return alternative.split(/\s+/).some(token => inputCodeKind(token) === 'joystick');
}

/**
 * What the other player gets when one player's controls are copied to them: `source`'s gamepad
 * alternatives with joysticks 1 and 2 swapped ("JOYCODE_1_BUTTON1" -> "JOYCODE_2_BUTTON1" and back),
 * after `target`'s own keyboard and mouse ones. `source`'s keys are left out: shared, one key would
 * play both players. Other joysticks (3 and up) are copied as they are.
 */
export function mirrorSeqToOtherPlayer(source: string, target: string): string {
    const kept = seqAlternatives(target).filter(alternative => !isGamepadAlternative(alternative));
    const mirrored = seqAlternatives(source)
        .filter(isGamepadAlternative)
        .map(alternative => alternative.replace(/\bJOYCODE_([12])_/g, (_, joystick: string) => `JOYCODE_${joystick === '1' ? 2 : 1}_`));
    return seqFromAlternatives([...new Set([...kept, ...mirrored])]);
}
