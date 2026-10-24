import {existsSync, readFileSync, rmSync, writeFileSync} from 'fs';
import {homedir} from 'os';
import {join} from 'path';

// Which sound output a dedicated cabinet uses (the BO's MAUI tab, Config.audioOutput). MAME plays
// through ALSA there (SDL_AUDIO_DRIVER=alsa in ~/.xinitrc, docs/RASPBERRY-PI-DEPLOY.md §6.4), and
// ALSA reads the user's ~/.asoundrc after /etc/asound.conf (maui-cabinets' asound.conf.j2): MAUI
// writes the default device there, no root needed. A game started afterwards uses it at once;
// MAUI's own window, at its next start. Automatic removes MAUI's file, back to the system's
// default. A ~/.asoundrc MAUI did not write is never touched.

export interface AudioDevice {
    // "card,device", the card by its id: "vc4hdmi0,0", "PCH,3".
    id: string;
    label: string;
}

const MARKER = '# Written by MAUI (BO > MAUI > Screen > Sound output): any change here is overwritten.';
const DEVICE_ID = /^([A-Za-z0-9_]{1,32}),(\d{1,2})$/;

/** '' (automatic) or a "card,device", from an untrusted value (BO form, config file). */
export function parseAudioOutputSetting(value: unknown): string {
    return typeof value === 'string' && DEVICE_ID.test(value) ? value : '';
}

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
            label: several ? `${card.name}, device ${device} (${pcm[4] || pcm[3]})` : card.name,
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

/** ~/.asoundrc for `id`: the same default as maui-cabinets' asound.conf.j2, through plug. */
export function renderAsoundrc(id: string): string {
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
`;
}

export function getAsoundrcPath(): string {
    return join(homedir(), '.asoundrc');
}

/**
 * Makes `id` the default sound output ('' gives it back to the system). Throws, with nothing
 * written, when a ~/.asoundrc MAUI did not write is in the way.
 */
export function applyAudioOutput(id: string, path: string = getAsoundrcPath()): void {
    const ours = !existsSync(path) || readFileSync(path, 'utf8').startsWith(MARKER);
    if (!ours) {
        throw new Error(`${path} was not written by MAUI: it is left as it is.`);
    }
    if (!id) {
        rmSync(path, {force: true});
        return;
    }
    writeFileSync(path, renderAsoundrc(id));
}
