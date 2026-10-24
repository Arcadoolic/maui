import {execFileSync} from 'child_process';

// Which screen output a dedicated cabinet uses (the BO's MAUI tab, Config.videoOutput), set with
// xrandr before the window opens, like its mode (DisplayMode.ts): the output picked becomes the
// primary one, the other connected ones are switched off, so that the front and MAME (which
// follows the desktop) both show on it. No root needed: xrandr acts on the kiosk's own X session.

export interface ScreenOutputInfo {
    name: string;
    connected: boolean;
    primary: boolean;
}

// What xrandr names an output: "HDMI-1", "HDMI-A-1", "DP-2"... Also checked on what the BO saves.
const OUTPUT_NAME = /^[A-Za-z0-9_.-]{1,32}$/;

/** '' (automatic) or an output name, from an untrusted value (BO form, config file). */
export function parseVideoOutputSetting(value: unknown): string {
    return typeof value === 'string' && OUTPUT_NAME.test(value) ? value : '';
}

/** Every output of `xrandr --query`, connected or not, in its order. */
export function parseXrandrOutputs(text: string): ScreenOutputInfo[] {
    const outputs: ScreenOutputInfo[] = [];
    for (const line of text.split('\n')) {
        const header = /^(\S+) (connected|disconnected)( primary)?/.exec(line);
        if (header && OUTPUT_NAME.test(header[1])) {
            outputs.push({name: header[1], connected: header[2] === 'connected', primary: !!header[3]});
        }
    }
    return outputs;
}

/**
 * The xrandr arguments that put the picture on `name` alone, null when it has nothing to do:
 * automatic (''), an output that is not connected (the screen was moved to another port: better
 * a picture where X put it than none), or the only connected output already primary.
 */
export function videoOutputArgs(name: string, outputs: ScreenOutputInfo[]): string[] | null {
    const target = outputs.find(output => output.name === name && output.connected);
    if (!name || !target) {
        return null;
    }
    const others = outputs.filter(output => output.connected && output.name !== name);
    if (target.primary && !others.length) {
        return null;
    }
    return ['--output', name, '--auto', '--primary', ...others.flatMap(output => ['--output', output.name, '--off'])];
}

type Exec = (file: string, args: string[], options: {encoding: 'utf8'; timeout: number}) => string;

/** The outputs as xrandr sees them. Throws what xrandr throws (missing, no X server). */
export function listScreenOutputs(exec: Exec = execFileSync as Exec): ScreenOutputInfo[] {
    return parseXrandrOutputs(exec('xrandr', ['--query'], {encoding: 'utf8', timeout: 5000}));
}

/**
 * Puts the picture on the output `name`. Returns it once done, null when there was nothing to
 * change. Throws what xrandr throws: the caller logs it and carries on.
 */
export function applyVideoOutput(name: string, exec: Exec = execFileSync as Exec): string | null {
    if (!name) {
        return null;
    }
    const args = videoOutputArgs(name, listScreenOutputs(exec));
    if (!args) {
        return null;
    }
    exec('xrandr', args, {encoding: 'utf8', timeout: 5000});
    return name;
}
