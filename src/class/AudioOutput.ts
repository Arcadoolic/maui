import {existsSync, readdirSync, readFileSync, unlinkSync, writeFileSync} from 'fs';
import {homedir} from 'os';
import {join} from 'path';
import {currentScreenOutput, listScreenOutputs} from '@/class/VideoOutput';

// Which sound output a dedicated cabinet uses (the BO's MAUI tab, Config.audioOutput). MAME plays
// through ALSA there (SDL_AUDIO_DRIVER=alsa in ~/.xinitrc, docs/RASPBERRY-PI-DEPLOY.md §6.4), and
// ALSA reads the user's ~/.asoundrc after /etc/asound.conf (maui-cabinets' asound.conf.j2): MAUI
// writes the default device there, no root needed: MAUI's own window uses it at its next start.
// MAME does not follow ALSA's default: each game names its output in its cfg file, which the
// front writes before each game (MameSoundMap.ts, gameSoundNode()). And since SDL opens an
// output by its `hw:` name, which a Raspberry Pi's HDMI refuses ("Sample format non
// available"), ~/.asoundrc also makes `hw:` go through plug, as /etc/asound.conf's default
// does. The default, FOLLOW_SCREEN, takes the HDMI card of the screen output (VideoOutput.ts);
// '' leaves the default output to the system. A ~/.asoundrc MAUI did not write is never touched.
// All of this only where MAME plays straight on ALSA: where a sound server runs (PipeWire, as on
// Raspberry Pi OS desktop), it owns the cards and picks the output, MAME goes through it, and the
// ALSA names above mean nothing to it (soundServerRunning()).

export interface AudioDevice {
    // "card,device", the card by its id: "vc4hdmi0,0", "PCH,3".
    id: string;
    label: string;
    // What SDL (hence MAME) calls it: "<card name>, <pcm name>", "vc4-hdmi-0, MAI PCM i2s-hifi-0".
    node: string;
}

const MARKER = '# Written by MAUI (BO > MAUI > Screen > Sound output): any change here is overwritten.';
const DEVICE_ID = /^([A-Za-z0-9_]{1,32}),(\d{1,2})$/;

/**
 * Whether a sound server (PipeWire, PulseAudio) runs for this user, seen from its socket: it then
 * picks the output, MAME plays through it (a system MAME uses its pulse module whatever
 * SDL_AUDIO_DRIVER says), and a game's cfg mapped to an ALSA name stays silent.
 */
export function soundServerRunning(runtimeDir: string | undefined = process.env.XDG_RUNTIME_DIR): boolean {
    return !!runtimeDir && ['pipewire-0', join('pulse', 'native')].some(socket => existsSync(join(runtimeDir, socket)));
}

/** The setting that sends the sound where the picture goes: the HDMI port of the screen. */
export const FOLLOW_SCREEN = 'screen';

/**
 * FOLLOW_SCREEN, '' (the system's default) or a "card,device", from an untrusted value (BO form,
 * config file). A config file from before this setting follows the screen.
 */
export function parseAudioOutputSetting(value: unknown): string {
    if (value === undefined || value === FOLLOW_SCREEN) {
        return FOLLOW_SCREEN;
    }
    return typeof value === 'string' && DEVICE_ID.test(value) ? value : '';
}

/**
 * The sound card of a screen output: a Raspberry Pi's HDMI-1 port is vc4hdmi0, HDMI-2 vc4hdmi1
 * (xrandr counts from 1, ALSA from 0). '' when the output has no card of its own here (another
 * machine, a screen output that is not HDMI).
 */
export function audioDeviceForScreen(screenOutput: string, devices: AudioDevice[]): string {
    const port = /^HDMI-(?:A-)?(\d)$/.exec(screenOutput);
    const id = port ? `vc4hdmi${Number(port[1]) - 1},0` : '';
    return devices.some(device => device.id === id) ? id : '';
}

/** The device a setting comes down to, '' for the system's default. */
export function resolveAudioOutput(setting: string, screenOutput: string, devices: AudioDevice[]): string {
    return setting === FOLLOW_SCREEN ? audioDeviceForScreen(screenOutput, devices) : setting;
}

// The cards of a Raspberry Pi, named after where the sound comes out rather than their driver.
const KNOWN_CARDS: Record<string, string> = {
    Headphones: "Raspberry Pi's 3.5 mm jack",
    vc4hdmi0: 'HDMI-1 port (the screen\'s speakers or its headphone socket)',
    vc4hdmi1: 'HDMI-2 port (the screen\'s speakers or its headphone socket)',
};

/**
 * The playback devices of /proc/asound/cards and /proc/asound/pcm: one per card and device, named
 * after the card ("vc4-hdmi-0") and the device when the card has several.
 */
export function parseAlsaDevices(cardsText: string, pcmText: string): AudioDevice[] {
    const cards = new Map<number, {id: string; name: string}>();
    for (const line of cardsText.split('\n')) {
        // " 1 [vc4hdmi0       ]: vc4-hdmi - vc4-hdmi-0"
        const card = /^\s*(\d+)\s+\[([A-Za-z0-9_]+)\s*\]:\s*\S+\s+-\s+(.+?)\s*$/.exec(line);
        if (card) {
            cards.set(Number(card[1]), {id: card[2], name: card[3]});
        }
    }
    const devices: AudioDevice[] = [];
    const lines = pcmText.split('\n');
    for (const line of lines) {
        // "01-00: MAI PCM i2s-hifi-0 : MAI PCM i2s-hifi-0 : playback 1"
        const pcm = /^(\d+)-(\d+):\s*(.*?)\s*:\s*(.*?)\s*:\s*(.*)$/.exec(line);
        const card = pcm && cards.get(Number(pcm[1]));
        if (!pcm || !card || !/\bplayback\b/.test(pcm[5])) {
            continue;
        }
        const device = Number(pcm[2]);
        const several = lines.filter(other => other.startsWith(`${pcm[1]}-`) && /\bplayback\b/.test(other)).length > 1;
        devices.push({
            id: `${card.id},${device}`,
            label: KNOWN_CARDS[card.id] ?? (several ? `${card.name}, device ${device} (${pcm[4] || pcm[3]})` : card.name),
            node: `${card.name}, ${pcm[4] || pcm[3]}`,
        });
    }
    return devices;
}

/** The playback devices of this machine; none where /proc/asound is not there (macOS, Windows). */
export function listAudioDevices(): AudioDevice[] {
    try {
        return parseAlsaDevices(readFileSync('/proc/asound/cards', 'utf8'), readFileSync('/proc/asound/pcm', 'utf8'));
    } catch {
        return [];
    }
}

// `hw:CARD,DEV` through plug, for whoever opens a card by its `hw:` name (SDL, hence MAME): same
// arguments and defaults as alsa.conf's own pcm.hw, the hardware itself one level down.
const HW_THROUGH_PLUG = `pcm.!hw {
    @args [ CARD DEV SUBDEV ]
    @args.CARD { type string default { @func getenv vars [ ALSA_PCM_CARD ALSA_CARD ] default { @func refer name defaults.pcm.card } } }
    @args.DEV { type integer default { @func igetenv vars [ ALSA_PCM_DEVICE ] default { @func refer name defaults.pcm.device } } }
    @args.SUBDEV { type integer default { @func refer name defaults.pcm.subdevice } }
    type plug
    slave.pcm { type hw card $CARD device $DEV subdevice $SUBDEV }
    hint { show on description "Hardware device, converted by MAUI" device $DEV }
}
`;

/**
 * ~/.asoundrc for `id` ('' for the system's default output): the same default as maui-cabinets'
 * asound.conf.j2, through plug, and `hw:` through plug too.
 */
export function renderAsoundrc(id: string): string {
    if (!id) {
        return `${MARKER}
${HW_THROUGH_PLUG}`;
    }
    const match = DEVICE_ID.exec(id);
    if (!match) {
        throw new Error(`Not an ALSA device: ${id}`);
    }
    return `${MARKER}
pcm.!default {
    type plug
    slave.pcm "hw:${match[1]},${match[2]}"
}
ctl.!default {
    type hw
    card ${match[1]}
}
${HW_THROUGH_PLUG}`;
}

export function getAsoundrcPath(): string {
    return join(homedir(), '.asoundrc');
}

/**
 * Makes `id` the default sound output ('' leaves it to the system). Throws, with nothing
 * written, when a ~/.asoundrc MAUI did not write is in the way.
 */
export function applyAudioOutput(id: string, path: string = getAsoundrcPath()): void {
    const ours = !existsSync(path) || readFileSync(path, 'utf8').startsWith(MARKER);
    if (!ours) {
        throw new Error(`${path} was not written by MAUI: it is left as it is.`);
    }
    writeFileSync(path, renderAsoundrc(id));
}

/**
 * Removes the ~/.asoundrc MAUI wrote, where a sound server makes it pointless: its default output
 * would go round the server. A file MAUI did not write is left as it is.
 */
export function removeAudioOutput(path: string = getAsoundrcPath()): void {
    if (existsSync(path) && readFileSync(path, 'utf8').startsWith(MARKER)) {
        unlinkSync(path);
    }
}

/**
 * What a game launched now must play on (its `node` is how MAME names it, MameSoundMap.ts): the
 * output the BO set, the screen's HDMI card by default. Undefined to leave MAME to itself: the
 * system's default, or an output this machine does not have.
 */
export function gameSoundDevice(setting: string, videoSetting: string): AudioDevice | undefined {
    const devices = listAudioDevices();
    let screen = '';
    try {
        screen = currentScreenOutput(videoSetting, listScreenOutputs());
    } catch {
        // No xrandr answer: no screen output to follow.
    }
    const id = resolveAudioOutput(setting, screen, devices);
    return devices.find(device => device.id === id);
}

/**
 * Whether a playback stream of `card` (its id, "vc4hdmi0"), or of any card when none is given,
 * is open: what /proc/asound/<card>/pcm<N>p/sub<N>/status says, "closed" when it is not. False
 * where /proc/asound is not there.
 */
export function playbackOpen(card?: string, root: string = '/proc/asound'): boolean {
    try {
        const cards = card ? [card] : readdirSync(root).filter(name => /^card\d+$/.test(name));
        return cards.some(name => readdirSync(join(root, name)).filter(pcm => /^pcm\d+p$/.test(pcm)).some(pcm =>
            readdirSync(join(root, name, pcm)).filter(sub => /^sub\d+$/.test(sub)).some(sub =>
                !readFileSync(join(root, name, pcm, sub, 'status'), 'utf8').startsWith('closed'))));
    } catch {
        return false;
    }
}

/**
 * Waits for `card` to be let go (playbackOpen()), `timeoutMs` at most. Without a sound server,
 * a card is opened by one program at a time: Chromium keeps the front's output open a few
 * seconds after its last sound (UiSounds.ts), and a MAME started meanwhile finds the card busy
 * and plays its whole game silent. Resolves with the time waited, null when it was still open.
 */
export async function waitForPlaybackClosed(
    card: string | undefined, timeoutMs: number, isOpen: (card?: string) => boolean = playbackOpen, pollMs: number = 100,
): Promise<number | null> {
    const start = Date.now();
    while (isOpen(card)) {
        if (Date.now() - start >= timeoutMs) {
            return null;
        }
        await new Promise(resolve => setTimeout(resolve, pollMs));
    }
    return Date.now() - start;
}
