import {describe, it, expect, afterEach} from 'vitest';
import {mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync} from 'fs';
import {tmpdir} from 'os';
import {join} from 'path';
import {
    applyVideoOutput, parseVideoOutputSetting, parseXrandrOutputs, videoOutputArgs,
} from '@/class/VideoOutput';
import {
    applyAudioOutput, audioDeviceForScreen, FOLLOW_SCREEN, parseAlsaDevices, parseAudioOutputSetting, renderAsoundrc,
    resolveAudioOutput,
} from '@/class/AudioOutput';
import {currentScreenOutput} from '@/class/VideoOutput';

// What a Raspberry Pi 4 (arcade-dkong) gives, its screen on the first HDMI port.
const XRANDR = `Screen 0: minimum 320 x 200, current 1920 x 1080, maximum 7680 x 7680
HDMI-1 connected primary 1920x1080+0+0 (normal left inverted right x axis y axis) 345mm x 194mm
   1920x1080     60.00*+ 144.00   120.00   100.00    59.94
   1280x720      60.00
HDMI-2 disconnected (normal left inverted right x axis y axis)
`;
const CARDS = ` 0 [Headphones     ]: bcm2835_headpho - bcm2835 Headphones
                      bcm2835 Headphones
 1 [vc4hdmi0       ]: vc4-hdmi - vc4-hdmi-0
                      vc4-hdmi-0
 2 [vc4hdmi1       ]: vc4-hdmi - vc4-hdmi-1
                      vc4-hdmi-1
`;
const PCM = `00-00: bcm2835 Headphones : bcm2835 Headphones : playback 8
01-00: MAI PCM i2s-hifi-0 : MAI PCM i2s-hifi-0 : playback 1
02-00: MAI PCM i2s-hifi-0 : MAI PCM i2s-hifi-0 : playback 1
`;

describe('video output', () => {
    it('lists every output, connected or not', () => {
        expect(parseXrandrOutputs(XRANDR)).toEqual([
            {name: 'HDMI-1', connected: true, primary: true},
            {name: 'HDMI-2', connected: false, primary: false},
        ]);
    });

    it('does nothing when automatic, or when the output asked for has no screen', () => {
        const outputs = parseXrandrOutputs(XRANDR);
        expect(videoOutputArgs('', outputs)).toBeNull();
        expect(videoOutputArgs('HDMI-2', outputs)).toBeNull();
        // Already the only one, and primary.
        expect(videoOutputArgs('HDMI-1', outputs)).toBeNull();
    });

    it('puts the picture on the output asked for and switches the others off', () => {
        const outputs = [
            {name: 'HDMI-1', connected: true, primary: true},
            {name: 'HDMI-2', connected: true, primary: false},
        ];
        expect(videoOutputArgs('HDMI-2', outputs))
            .toEqual(['--output', 'HDMI-2', '--auto', '--primary', '--output', 'HDMI-1', '--off']);
    });

    it('runs xrandr with those arguments', () => {
        const calls: string[][] = [];
        const twoScreens = XRANDR.replace('HDMI-2 disconnected', 'HDMI-2 connected');
        const applied = applyVideoOutput('HDMI-2', (_file, args) => {
            calls.push(args);
            return args[0] === '--query' ? twoScreens : '';
        });
        expect(applied).toBe('HDMI-2');
        expect(calls[1]).toEqual(['--output', 'HDMI-2', '--auto', '--primary', '--output', 'HDMI-1', '--off']);
    });

    it('only keeps an output name as a setting', () => {
        expect(parseVideoOutputSetting('HDMI-A-1')).toBe('HDMI-A-1');
        expect(parseVideoOutputSetting('HDMI-1; rm -rf /')).toBe('');
        expect(parseVideoOutputSetting(undefined)).toBe('');
    });
});

describe('sound output', () => {
    let dir: string | undefined;
    afterEach(() => {
        if (dir) {
            rmSync(dir, {recursive: true, force: true});
        }
    });

    it('names a Raspberry Pi\'s cards after where the sound comes out', () => {
        expect(parseAlsaDevices(CARDS, PCM)).toEqual([
            {id: 'Headphones,0', label: 'Raspberry Pi\'s 3.5 mm jack'},
            {id: 'vc4hdmi0,0', label: 'HDMI-1 port (the screen\'s speakers or its headphone socket)'},
            {id: 'vc4hdmi1,0', label: 'HDMI-2 port (the screen\'s speakers or its headphone socket)'},
        ]);
    });

    it('follows the screen: HDMI-1 is vc4hdmi0, HDMI-2 vc4hdmi1', () => {
        const devices = parseAlsaDevices(CARDS, PCM);
        expect(audioDeviceForScreen('HDMI-1', devices)).toBe('vc4hdmi0,0');
        expect(audioDeviceForScreen('HDMI-A-2', devices)).toBe('vc4hdmi1,0');
        // Not a Pi's HDMI port, or a machine without these cards: the system's default.
        expect(audioDeviceForScreen('DP-1', devices)).toBe('');
        expect(audioDeviceForScreen('HDMI-1', [])).toBe('');
        expect(resolveAudioOutput(FOLLOW_SCREEN, 'HDMI-2', devices)).toBe('vc4hdmi1,0');
        expect(resolveAudioOutput('Headphones,0', 'HDMI-2', devices)).toBe('Headphones,0');
        expect(resolveAudioOutput('', 'HDMI-2', devices)).toBe('');
    });

    it('follows the output the picture is on: the one set when it has a screen, else the primary one', () => {
        const outputs = parseXrandrOutputs(XRANDR);
        expect(currentScreenOutput('', outputs)).toBe('HDMI-1');
        expect(currentScreenOutput('HDMI-2', outputs)).toBe('HDMI-1');
        expect(currentScreenOutput('', [])).toBe('');
    });

    it('names the device when a card has several', () => {
        const cards = ' 0 [PCH            ]: HDA-Intel - HDA Intel PCH\n';
        const pcm = '00-00: ALC892 Analog : ALC892 Analog : playback 1 : capture 1\n00-03: HDMI 0 : HDMI 0 : playback 1\n';
        expect(parseAlsaDevices(cards, pcm)).toEqual([
            {id: 'PCH,0', label: 'HDA Intel PCH, device 0 (ALC892 Analog)'},
            {id: 'PCH,3', label: 'HDA Intel PCH, device 3 (HDMI 0)'},
        ]);
    });

    it('writes the default device through plug, as /etc/asound.conf does', () => {
        expect(renderAsoundrc('vc4hdmi1,0')).toContain('slave.pcm "hw:vc4hdmi1,0"');
        expect(renderAsoundrc('vc4hdmi1,0')).toContain('card vc4hdmi1');
        expect(() => renderAsoundrc('x"; y')).toThrow();
        expect(parseAudioOutputSetting('vc4hdmi0,0')).toBe('vc4hdmi0,0');
        expect(parseAudioOutputSetting('hw:0')).toBe('');
        // Following the screen is the default, also for a config file from before the setting.
        expect(parseAudioOutputSetting(undefined)).toBe(FOLLOW_SCREEN);
        expect(parseAudioOutputSetting('')).toBe('');
    });

    it('writes and removes its own ~/.asoundrc, never one it did not write', () => {
        dir = mkdtempSync(join(tmpdir(), 'maui-asoundrc-'));
        const path = join(dir, '.asoundrc');
        applyAudioOutput('vc4hdmi1,0', path);
        expect(readFileSync(path, 'utf8')).toContain('hw:vc4hdmi1,0');
        applyAudioOutput('', path);
        expect(existsSync(path)).toBe(false);

        writeFileSync(path, 'pcm.!default { type hw card 1 }\n');
        expect(() => applyAudioOutput('vc4hdmi0,0', path)).toThrow(/not written by MAUI/);
        expect(readFileSync(path, 'utf8')).toBe('pcm.!default { type hw card 1 }\n');
    });
});
