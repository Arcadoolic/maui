import {execFileSync} from 'child_process';

// The screen mode of a dedicated cabinet (docs/RASPBERRY-PI-DEPLOY.md §5: a bare X session
// started by ~/.xinitrc), set with xrandr before the window opens. Arcade games were drawn for
// 240 lines: above 1080 the extra pixels only cost, and on a Raspberry Pi 3 720 lines already
// free a good part of what MAME spends on its picture (docs/RASPBERRY-PI-LAG.md). MAME follows
// the desktop's mode (mame.ini: switchres 0, resolution auto), so this one setting covers both.

export const DISPLAY_MODE_SETTINGS = ['auto', '1080p', '720p', 'native'] as const;
/** What the BO's MAUI tab stores. "native" leaves the screen as the X session started it. */
export type DisplayModeSetting = typeof DISPLAY_MODE_SETTINGS[number];

export interface ScreenMode {
    width: number;
    height: number;
}

export interface DisplayOutput {
    name: string;
    // null when the output is connected but off.
    current: ScreenMode | null;
    modes: ScreenMode[];
}

/** Anything but a known setting (older config file, hand edit) reads as "auto". */
export function parseDisplayModeSetting(value: unknown): DisplayModeSetting {
    return DISPLAY_MODE_SETTINGS.find(setting => setting === value) ?? 'auto';
}

/**
 * The connected output of `xrandr --query` - the primary one when there are several - with its
 * modes; null when none is connected or the text is something else.
 */
export function parseXrandr(text: string): DisplayOutput | null {
    const outputs: Array<DisplayOutput & {primary: boolean}> = [];
    let output: (DisplayOutput & {primary: boolean}) | null = null;
    for (const line of text.split('\n')) {
        const header = /^(\S+) (connected|disconnected)( primary)?(?: (\d+)x(\d+)\+\d+\+\d+)?/.exec(line);
        if (header) {
            output = null;
            if (header[2] === 'connected') {
                output = {
                    name: header[1],
                    primary: !!header[3],
                    current: header[4] ? {width: Number(header[4]), height: Number(header[5])} : null,
                    modes: [],
                };
                outputs.push(output);
            }
            continue;
        }
        // "   1920x1080     60.00*+  50.00": interlaced modes ("1920x1080i") are left out.
        const mode = /^\s+(\d+)x(\d+)\s/.exec(line);
        if (mode && output) {
            output.modes.push({width: Number(mode[1]), height: Number(mode[2])});
        }
    }
    const found = outputs.find(candidate => candidate.primary) ?? outputs[0];
    return found ? {name: found.name, current: found.current, modes: found.modes} : null;
}

/** The tallest mode of at most `maxHeight` lines, the widest of them. */
function tallestWithin(modes: ScreenMode[], maxHeight: number): ScreenMode | null {
    return modes
        .filter(mode => mode.height <= maxHeight)
        .sort((a, b) => b.height - a.height || b.width - a.width)[0] ?? null;
}

/**
 * The mode to switch `output` to, or null to leave it as it is.
 * - "auto" is a ceiling: 1080 lines, 720 in Lite mode. A screen already at or under it is left
 *   alone, whatever else it offers (a 1366x768 panel stays native).
 * - "1080p" / "720p" ask for that height, or the closest one under it the screen has.
 */
export function pickMode(setting: DisplayModeSetting, output: DisplayOutput, lite: boolean): ScreenMode | null {
    if (setting === 'native') {
        return null;
    }
    const maxHeight = setting === '720p' || (setting === 'auto' && lite) ? 720 : 1080;
    if (setting === 'auto' && output.current && output.current.height <= maxHeight) {
        return null;
    }
    const mode = tallestWithin(output.modes, maxHeight);
    if (!mode || (output.current && mode.width === output.current.width && mode.height === output.current.height)) {
        return null;
    }
    return mode;
}

type Exec = (file: string, args: string[], options: {encoding: 'utf8'; timeout: number}) => string;

/**
 * Switches the screen to the mode `setting` asks for. Returns the mode set, null when there was
 * nothing to change. Throws what xrandr throws (missing, no X server): the caller logs it and
 * carries on, the application must start on whatever the screen shows.
 */
export function applyDisplayMode(
    setting: DisplayModeSetting, lite: boolean, exec: Exec = execFileSync as Exec,
): ScreenMode | null {
    if (setting === 'native') {
        return null;
    }
    const output = parseXrandr(exec('xrandr', ['--query'], {encoding: 'utf8', timeout: 5000}));
    const mode = output && pickMode(setting, output, lite);
    if (!output || !mode) {
        return null;
    }
    exec('xrandr', ['--output', output.name, '--mode', `${mode.width}x${mode.height}`], {encoding: 'utf8', timeout: 5000});
    return mode;
}
