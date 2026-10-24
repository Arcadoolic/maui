import {existsSync, mkdirSync, readFileSync, writeFileSync} from 'fs';
import {join} from 'path';

// Where a game's sound comes out, in MAME's own terms. Since MAME 0.278 each game keeps, in its
// cfg file (cfg/<rom>.cfg), which output each of its speakers plays on: a <sound_map> per speaker,
// naming the output as SDL lists it ("o:vc4-hdmi-0, MAI PCM i2s-hifi-0"). mame.ini has no such
// setting, and a game without one plays on the first output SDL finds: a Raspberry Pi's 3.5 mm
// jack, whatever ~/.asoundrc says. So before each game the front writes the output picked in the
// BO (AudioOutput.ts) into the game's cfg file, for each of its speakers; MAME keeps it when it
// writes the file back on exit.

const SPEAKER_REF = /<device_ref tag="(:[^"]+)" name="speaker"\s*\/>/g;
const SOUND_MAP = /<sound_map tag="([^"]+)"\s*(?:\/>|>[\s\S]*?<\/sound_map>)/g;

function escapeXml(value: string): string {
    return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** The speakers of a game, from `mame -listxml <rom>`: ":mono", ":speaker", ":lspeaker"... */
export function speakerTagsFromListXml(xml: string): string[] {
    return [...new Set([...xml.matchAll(SPEAKER_REF)].map(match => match[1]))];
}

/** The speakers a cfg file already maps (MAME writes one <sound_map> per speaker). */
export function soundMapTags(cfg: string): string[] {
    return [...new Set([...cfg.matchAll(SOUND_MAP)].map(match => match[1]))];
}

function soundMap(tag: string, node: string): string {
    return `<sound_map tag="${escapeXml(tag)}">\n`
        + `                <node_mapping node="${escapeXml(node)}" db="0.000000" />\n`
        + '            </sound_map>';
}

/**
 * `cfg` (a game's cfg file, null when it has none yet) with every one of `tags` mapped to the
 * output `node` (SDL's name for it). The rest of the file is left as it is.
 */
export function withSoundOutput(cfg: string | null, system: string, tags: string[], node: string): string {
    const output = `o:${node}`;
    const maps = tags.map(tag => soundMap(tag, output));
    if (cfg === null) {
        return '<?xml version="1.0"?>\n<mameconfig version="10">\n'
            + `    <system name="${escapeXml(system)}">\n        <mixer>\n`
            + maps.map(map => `            ${map}\n`).join('')
            + '        </mixer>\n    </system>\n</mameconfig>\n';
    }
    let text = cfg.replace(SOUND_MAP, (whole, tag: string) => (tags.includes(tag) ? soundMap(tag, output) : whole));
    const missing = tags.filter(tag => !soundMapTags(text).includes(tag)).map(tag => soundMap(tag, output));
    if (!missing.length) {
        return text;
    }
    const block = missing.map(map => `            ${map}\n`).join('');
    if (text.includes('</mixer>')) {
        text = text.replace('</mixer>', `${block.trimStart()}        </mixer>`);
    } else if (text.includes('</system>')) {
        text = text.replace('</system>', `    <mixer>\n${block}        </mixer>\n    </system>`);
    }
    return text;
}

/**
 * Writes the output `node` into `<cfgDirectory>/<romName>.cfg` for each speaker of the game:
 * those the file maps already, else those `listSpeakers()` gives (only called the first time a
 * game is played, `mame -listxml` being slow on a Pi). Nothing is written without a speaker.
 */
export function applyGameSoundOutput(cfgDirectory: string, romName: string, node: string, listSpeakers: () => string[]): void {
    const path = join(cfgDirectory, `${romName}.cfg`);
    const cfg = existsSync(path) ? readFileSync(path, 'utf8') : null;
    const known = cfg ? soundMapTags(cfg) : [];
    const tags = known.length ? known : listSpeakers();
    if (!tags.length) {
        return;
    }
    const next = withSoundOutput(cfg, romName, tags, node);
    if (next !== cfg) {
        mkdirSync(cfgDirectory, {recursive: true});
        writeFileSync(path, next);
    }
}
