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
}

// The fields worth remapping per game: directions, buttons, coin and start (same subset as the
// global remap card, extended to the 4 players some drivers have).
const REMAPPABLE_PORT_TYPE = /^(?:P[1-4]_(?:JOYSTICK_(?:UP|DOWN|LEFT|RIGHT)|BUTTON\d+)|COIN[1-4]|START[1-4])$/;

export function isRemappablePortType(portType: string): boolean {
    return REMAPPABLE_PORT_TYPE.test(portType);
}

/** Stable identifier of a field, also what an override in the cfg is matched by. */
export function gameFieldId(field: Pick<GameField, 'portType' | 'tag' | 'mask' | 'defvalue'>): string {
    return `${field.portType}|${field.tag}|${field.mask}|${field.defvalue}`;
}

/**
 * Parses capture-daemon.lua's game-fields.txt, one
 * `<PORT_TYPE>|<tag>|<mask>|<defvalue>|<default sequence>|<field name>` line per field. Anything
 * malformed or not remappable is skipped.
 */
export function parseGameFields(content: string): GameField[] {
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
        fields.push({
            portType,
            tag,
            mask: maskNumber,
            defvalue: defvalueNumber,
            defaultSeq: (defaultSeq ?? '').trim(),
            name: nameParts.join('|').trim(),
        });
    }
    return fields;
}

/** Player number (1-4) a remappable port type belongs to (COIN/START carry theirs as a suffix). */
export function portTypePlayer(portType: string): number {
    const match = /^P(\d)_/.exec(portType) ?? /(\d)$/.exec(portType);
    return match ? Number(match[1]) : 0;
}

/** Display order within a player: directions, buttons by number, then start and coin. */
export function compareGameFields(a: GameField, b: GameField): number {
    const rank = (portType: string): number => {
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
const STANDARD_NEWSEQ = /<newseq type="standard">([\s\S]*?)<\/newseq>/;

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

/** `<port>`'s standard `<newseq>` overrides, by gameFieldId(). Ports without one are ignored. */
export function readGameCfgInputSeqs(xml: string): Map<string, string> {
    const seqs = new Map<string, string>();
    const inputBlock = INPUT_BLOCK.exec(xml);
    if (!inputBlock) {
        return seqs;
    }
    for (const port of inputBlock[1].matchAll(PORT_ELEMENT)) {
        const seq = STANDARD_NEWSEQ.exec(port[2] ?? '');
        if (seq) {
            seqs.set(portAttributesId(parseAttributes(port[1])), seq[1].trim());
        }
    }
    return seqs;
}

function newSeqElement(seq: string): string {
    return '<newseq type="standard">\n'
        + `                    ${seq}\n`
        + '                </newseq>';
}

function newPortElement(field: GameField, seq: string): string {
    return `            <port type="${escapeAttribute(field.portType)}" tag="${escapeAttribute(field.tag)}"`
        + ` mask="${field.mask}" defvalue="${field.defvalue}">\n`
        + `                ${newSeqElement(seq)}\n`
        + '            </port>\n';
}

/**
 * Sets `field`'s standard sequence in `xml` (a game's existing cfg, or undefined to start a fresh
 * one for `systemName`), replacing an existing override for that field or adding one. Throws if
 * the file has no `<system>` element to attach an `<input>` block to - better than clobbering it.
 */
export function setGameCfgInputSeq(xml: string | undefined, systemName: string, field: GameField, seq: string): string {
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
        return `${source.slice(0, at)}        <input>\n${newPortElement(field, seq)}        </input>\n${source.slice(at)}`;
    }

    let replaced = false;
    const updatedInner = inputBlock[1].replace(PORT_ELEMENT, (whole, rawAttributes: string, inner: string | undefined) => {
        if (portAttributesId(parseAttributes(rawAttributes)) !== id) {
            return whole;
        }
        replaced = true;
        const children = inner ?? '';
        const updatedChildren = STANDARD_NEWSEQ.test(children)
            ? children.replace(STANDARD_NEWSEQ, () => newSeqElement(seq))
            : `${children.replace(/\s+$/, '')}\n                ${newSeqElement(seq)}\n            `;
        return `<port${rawAttributes.replace(/\/\s*$/, '')}>${updatedChildren}</port>`;
    });
    const newInner = replaced
        ? updatedInner
        : `${updatedInner.replace(/\s+$/, '')}\n${newPortElement(field, seq)}        `;
    return source.slice(0, inputBlock.index) + `<input>${newInner}</input>` + source.slice(inputBlock.index + inputBlock[0].length);
}

/**
 * Drops `field`'s standard sequence override so the global/default binding applies again. A port
 * left with nothing else in it is removed altogether, and so is an emptied `<input>` block. Returns
 * `xml` unchanged if there was no such override.
 */
export function removeGameCfgInputSeq(xml: string, field: GameField): string {
    const inputBlock = INPUT_BLOCK.exec(xml);
    if (!inputBlock) {
        return xml;
    }
    const id = gameFieldId(field);
    let removed = false;
    const updatedInner = inputBlock[1].replace(PORT_ELEMENT, (whole, rawAttributes: string, inner: string | undefined) => {
        if (portAttributesId(parseAttributes(rawAttributes)) !== id || !inner || !STANDARD_NEWSEQ.test(inner)) {
            return whole;
        }
        removed = true;
        const remaining = inner.replace(STANDARD_NEWSEQ, '');
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
