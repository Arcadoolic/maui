/**
 * Per-game MAME cfg (cfg/<romname>.cfg) input overrides. Unlike default.cfg's `<port type="...">`,
 * a game's `<port>` is only applied by MAME when it also carries the exact `tag`, `mask` and
 * `defvalue` of the field it targets - so those come from MAME itself (capture-daemon.lua's
 * game-fields.txt), never guessed. Electron-free like MameInputSeq.ts, so it stays unit-testable.
 *
 * Hand-rolled edit of the `<input>` block, not a general XML parser: everything else in the file
 * (mixer, counters, other ports, other `<newseq>` types) is preserved verbatim, and MAME rewrites
 * the file in its own canonical form on its next normal exit anyway.
 */

export interface GameField {
    // MAME's own <port type="..."> value, e.g. "P1_BUTTON1", "COIN1".
    portType: string;
    tag: string;
    mask: number;
    defvalue: number;
    // MAME's hardcoded default sequence (input:seq_to_tokens()), before any cfg override.
    defaultSeq: string;
    // MAME's display name for the field, e.g. "P1 Button 1", "1 Player Start".
    name: string;
    // An analog control (spinner, trackball, paddle...): `defaultSeq` is then the axis that moves
    // it, and these the keys that move it each way (capture-daemon.lua's game-analog.txt).
    analog?: {increment: string; decrement: string};
}

/**
 * The sequences of a field a cfg can hold: `standard` for every field (the axis, for an analog
 * one), `increment`/`decrement` for an analog one only.
 */
export type GameSeqType = 'standard' | 'increment' | 'decrement';

export const GAME_SEQ_TYPES: readonly GameSeqType[] = ['standard', 'increment', 'decrement'];

// The fields worth remapping per game: directions, buttons, coin and start (same subset as the
// global remap card, extended to the 4 players some drivers have), and the analog controls.
const DIGITAL_PORT_TYPE = /^(?:P[1-4]_(?:JOYSTICK_(?:UP|DOWN|LEFT|RIGHT)|BUTTON\d+)|COIN[1-4]|START[1-4])$/;
const ANALOG_PORT_TYPE = /^P[1-4]_(?:DIAL(?:_V)?|PADDLE(?:_V)?|TRACKBALL_[XY]|POSITIONAL(?:_V)?|AD_STICK_[XYZ]|PEDAL[23]?)$/;

export function isRemappablePortType(portType: string): boolean {
    return DIGITAL_PORT_TYPE.test(portType) || ANALOG_PORT_TYPE.test(portType);
}

export function isAnalogPortType(portType: string): boolean {
    return ANALOG_PORT_TYPE.test(portType);
}

/** Stable identifier of a field, also what an override in the cfg is matched by. */
export function gameFieldId(field: Pick<GameField, 'portType' | 'tag' | 'mask' | 'defvalue'>): string {
    return `${field.portType}|${field.tag}|${field.mask}|${field.defvalue}`;
}

/**
 * Parses capture-daemon.lua's game-fields.txt, one
 * `<PORT_TYPE>|<tag>|<mask>|<defvalue>|<default sequence>|<field name>` line per field. Anything
 * malformed or not remappable is skipped. `analogContent` is its game-analog.txt, one
 * `<tag>|<mask>|<increment sequence>|<decrement sequence>` line per analog field.
 */
export function parseGameFields(content: string, analogContent = ''): GameField[] {
    const analogSeqs = new Map<string, {increment: string; decrement: string}>();
    for (const line of analogContent.split(/\r?\n/)) {
        const [tag, mask, increment, decrement] = line.split('|');
        if (tag && mask !== undefined && decrement !== undefined) {
            analogSeqs.set(`${tag}|${Number(mask)}`, {increment: increment.trim(), decrement: decrement.trim()});
        }
    }
    const fields: GameField[] = [];
    for (const line of content.split(/\r?\n/)) {
        const [portType, tag, mask, defvalue, defaultSeq, ...nameParts] = line.split('|');
        if (!portType || !isRemappablePortType(portType) || tag === undefined) {
            continue;
        }
        const maskNumber = Number(mask);
        const defvalueNumber = Number(defvalue);
        if (!Number.isInteger(maskNumber) || !Number.isInteger(defvalueNumber)) {
            continue;
        }
        const analog = isAnalogPortType(portType)
            ? analogSeqs.get(`${tag}|${maskNumber}`) ?? {increment: '', decrement: ''}
            : undefined;
        fields.push({
            portType,
            tag,
            mask: maskNumber,
            defvalue: defvalueNumber,
            defaultSeq: (defaultSeq ?? '').trim(),
            name: nameParts.join('|').trim(),
            ...(analog ? {analog} : {}),
        });
    }
    return fields;
}

/** Player number (1-4) a remappable port type belongs to (COIN/START carry theirs as a suffix). */
export function portTypePlayer(portType: string): number {
    const match = /^P(\d)_/.exec(portType) ?? /(\d)$/.exec(portType);
    return match ? Number(match[1]) : 0;
}

// MAME's system commands on the Controls tab, by port type.
const SYSTEM_ICON_KEYS: Record<string, string> = {
    UI_CANCEL: 'quit',
    UI_PAUSE: 'pause',
    UI_MENU: 'menu',
    SERVICE: 'service',
    UI_SOFT_RESET: 'soft_reset',
    UI_RESET_MACHINE: 'hard_reset',
};

/**
 * Which of the BO's input icons (src/assets/input-icons/<key>.svg) illustrates a port type, or
 * undefined for one without an icon. Buttons past 9 get the plain button, with no number: the
 * icon set only has single digits.
 */
export function inputIconKey(portType: string): string | undefined {
    const system = SYSTEM_ICON_KEYS[portType];
    if (system) {
        return system;
    }
    if (/^COIN\d$/.test(portType)) {
        return 'coin';
    }
    if (/^START\d$/.test(portType)) {
        return 'start';
    }
    const direction = /^P\d_JOYSTICK_(UP|DOWN|LEFT|RIGHT)$/.exec(portType);
    if (direction) {
        return `joystick_${direction[1].toLowerCase()}`;
    }
    const button = /^P\d_BUTTON(\d+)$/.exec(portType);
    if (button) {
        return Number(button[1]) <= 9 ? `button_${button[1]}` : 'button';
    }
    return undefined;
}

/** Display order within a player: directions, analog controls, buttons by number, then start and coin. */
export function compareGameFields(a: GameField, b: GameField): number {
    const rank = (portType: string): number => {
        if (isAnalogPortType(portType)) {
            return 5;
        }
        const direction = ['UP', 'RIGHT', 'DOWN', 'LEFT'].findIndex(name => portType.endsWith(`_JOYSTICK_${name}`));
        if (direction !== -1) {
            return direction;
        }
        const button = /_BUTTON(\d+)$/.exec(portType);
        if (button) {
            return 10 + Number(button[1]);
        }
        return portType.startsWith('START') ? 1000 : 1001;
    };
    return portTypePlayer(a.portType) - portTypePlayer(b.portType)
        || rank(a.portType) - rank(b.portType)
        || a.tag.localeCompare(b.tag)
        || a.mask - b.mask;
}

const INPUT_BLOCK = /<input>([\s\S]*?)<\/input>/;
const PORT_ELEMENT = /<port\b([^>]*?)(?:\/>|>([\s\S]*?)<\/port>)/g;
function newSeqRegex(seqType: GameSeqType): RegExp {
    return new RegExp(`<newseq type="${seqType}">([\\s\\S]*?)<\\/newseq>`);
}

function parseAttributes(raw: string): Map<string, string> {
    const attributes = new Map<string, string>();
    const attributeRegex = /([\w-]+)="([^"]*)"/g;
    let match: RegExpExecArray | null;
    while ((match = attributeRegex.exec(raw)) !== null) {
        attributes.set(match[1], match[2]);
    }
    return attributes;
}

function escapeAttribute(value: string): string {
    return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function unescapeAttribute(value: string): string {
    return value.replace(/&quot;/g, '"').replace(/&gt;/g, '>').replace(/&lt;/g, '<').replace(/&amp;/g, '&');
}

function portAttributesId(attributes: Map<string, string>): string {
    return gameFieldId({
        portType: attributes.get('type') ?? '',
        tag: unescapeAttribute(attributes.get('tag') ?? ''),
        mask: Number(attributes.get('mask') ?? 0),
        defvalue: Number(attributes.get('defvalue') ?? 0),
    });
}

/** `<port>`'s `<newseq>` overrides of one type, by gameFieldId(). Ports without one are ignored. */
export function readGameCfgInputSeqs(xml: string, seqType: GameSeqType = 'standard'): Map<string, string> {
    const seqs = new Map<string, string>();
    const inputBlock = INPUT_BLOCK.exec(xml);
    if (!inputBlock) {
        return seqs;
    }
    for (const port of inputBlock[1].matchAll(PORT_ELEMENT)) {
        const seq = newSeqRegex(seqType).exec(port[2] ?? '');
        if (seq) {
            seqs.set(portAttributesId(parseAttributes(port[1])), seq[1].trim());
        }
    }
    return seqs;
}

function newSeqElement(seq: string, seqType: GameSeqType): string {
    return `<newseq type="${seqType}">\n`
        + `                    ${seq}\n`
        + '                </newseq>';
}

function newPortElement(field: GameField, seq: string, seqType: GameSeqType): string {
    return `            <port type="${escapeAttribute(field.portType)}" tag="${escapeAttribute(field.tag)}"`
        + ` mask="${field.mask}" defvalue="${field.defvalue}">\n`
        + `                ${newSeqElement(seq, seqType)}\n`
        + '            </port>\n';
}

/**
 * Sets `field`'s `seqType` sequence in `xml` (a game's existing cfg, or undefined to start a fresh
 * one for `systemName`), replacing an existing override for that field or adding one. Throws if
 * the file has no `<system>` element to attach an `<input>` block to - better than clobbering it.
 */
export function setGameCfgInputSeq(
    xml: string | undefined, systemName: string, field: GameField, seq: string, seqType: GameSeqType = 'standard',
): string {
    const seqRegex = newSeqRegex(seqType);
    const source = xml ?? `<?xml version="1.0"?>
<mameconfig version="10">
    <system name="${escapeAttribute(systemName)}">
    </system>
</mameconfig>
`;
    const id = gameFieldId(field);

    const inputBlock = INPUT_BLOCK.exec(source);
    if (!inputBlock) {
        const systemOpen = /<system\b[^>]*[^/]>\s*\n/.exec(source);
        if (!systemOpen) {
            throw new Error('No <system> element found in the game cfg.');
        }
        const at = systemOpen.index + systemOpen[0].length;
        return `${source.slice(0, at)}        <input>\n${newPortElement(field, seq, seqType)}        </input>\n${source.slice(at)}`;
    }

    let replaced = false;
    const updatedInner = inputBlock[1].replace(PORT_ELEMENT, (whole, rawAttributes: string, inner: string | undefined) => {
        if (portAttributesId(parseAttributes(rawAttributes)) !== id) {
            return whole;
        }
        replaced = true;
        const children = inner ?? '';
        const updatedChildren = seqRegex.test(children)
            ? children.replace(seqRegex, () => newSeqElement(seq, seqType))
            : `${children.replace(/\s+$/, '')}\n                ${newSeqElement(seq, seqType)}\n            `;
        return `<port${rawAttributes.replace(/\/\s*$/, '')}>${updatedChildren}</port>`;
    });
    const newInner = replaced
        ? updatedInner
        : `${updatedInner.replace(/\s+$/, '')}\n${newPortElement(field, seq, seqType)}        `;
    return source.slice(0, inputBlock.index) + `<input>${newInner}</input>` + source.slice(inputBlock.index + inputBlock[0].length);
}

/**
 * Drops `field`'s `seqType` sequence override so the global/default binding applies again. A port
 * left with nothing else in it is removed altogether, and so is an emptied `<input>` block. Returns
 * `xml` unchanged if there was no such override.
 */
export function removeGameCfgInputSeq(xml: string, field: GameField, seqType: GameSeqType = 'standard'): string {
    const seqRegex = newSeqRegex(seqType);
    const inputBlock = INPUT_BLOCK.exec(xml);
    if (!inputBlock) {
        return xml;
    }
    const id = gameFieldId(field);
    let removed = false;
    const updatedInner = inputBlock[1].replace(PORT_ELEMENT, (whole, rawAttributes: string, inner: string | undefined) => {
        if (portAttributesId(parseAttributes(rawAttributes)) !== id || !inner || !seqRegex.test(inner)) {
            return whole;
        }
        removed = true;
        const remaining = inner.replace(seqRegex, '');
        return remaining.trim() ? `<port${rawAttributes}>${remaining}</port>` : '';
    });
    if (!removed) {
        return xml;
    }
    const before = xml.slice(0, inputBlock.index);
    const after = xml.slice(inputBlock.index + inputBlock[0].length);
    // Only whitespace left between the tags: drop the whole block, and the blank line it leaves.
    return updatedInner.trim()
        ? `${before}<input>${updatedInner.replace(/\n(?:[ \t]*\n)+/g, '\n')}</input>${after}`
        : `${before.replace(/[ \t]*$/, '')}${after.replace(/^[ \t]*\n/, '')}`;
}

/** One `<newseq>` override of a game's cfg, with what MAME matches it by. */
export interface GameCfgOverride {
    portType: string;
    tag: string;
    mask: number;
    defvalue: number;
    seqType: GameSeqType;
    seq: string;
}

/** Every `<newseq>` override of a game's cfg, in file order. */
export function listGameCfgOverrides(xml: string): GameCfgOverride[] {
    const overrides: GameCfgOverride[] = [];
    const inputBlock = INPUT_BLOCK.exec(xml);
    if (!inputBlock) {
        return overrides;
    }
    for (const port of inputBlock[1].matchAll(PORT_ELEMENT)) {
        const attributes = parseAttributes(port[1]);
        for (const seqType of GAME_SEQ_TYPES) {
            const seq = newSeqRegex(seqType).exec(port[2] ?? '');
            if (seq) {
                overrides.push({
                    portType: attributes.get('type') ?? '',
                    tag: unescapeAttribute(attributes.get('tag') ?? ''),
                    mask: Number(attributes.get('mask') ?? 0),
                    defvalue: Number(attributes.get('defvalue') ?? 0),
                    seqType,
                    seq: seq[1].trim(),
                });
            }
        }
    }
    return overrides;
}

/**
 * Drops every `<newseq>` override of a game's cfg, so all its commands follow the global controls
 * again. Everything else is kept (DIP switches, counters, sound output...): a port left empty goes,
 * and so does an emptied `<input>` block.
 */
export function removeAllGameCfgInputSeqs(xml: string): string {
    let updated = xml;
    for (const override of listGameCfgOverrides(xml)) {
        updated = removeGameCfgInputSeq(updated, {...override, defaultSeq: '', name: ''}, override.seqType);
    }
    return updated;
}
