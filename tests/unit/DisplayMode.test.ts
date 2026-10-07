import {describe, it, expect} from 'vitest';
import {applyDisplayMode, parseDisplayModeSetting, parseXrandr, pickMode, type DisplayOutput} from '@/class/DisplayMode';

// The Raspberry Pi 3 cabinet (2026-10-07): X settled on 1152x864 although the screen offers
// 1920x1080 and 1280x720. `xrandr --query` down to the current mode, the modes after it as the
// kernel lists them (/sys/class/drm/card0-HDMI-A-1/modes), in xrandr's layout.
const PI3_XRANDR = `Screen 0: minimum 320 x 200, current 1152 x 864, maximum 2048 x 2048
HDMI-1 connected primary 1152x864+0+0 (normal left inverted right x axis y axis) 800mm x 335mm
   1920x1080     60.00    60.00    50.00    59.94  
   1680x1050     59.88  
   1600x900      60.00  
   1280x1024     75.02    60.02  
   1280x800      59.91  
   1152x864      59.97* 
   1280x720      60.00    50.00    59.94  
   1024x768      60.00  
   800x600       60.32  
   720x576       50.00  
   720x480       60.00    59.94  
   640x480       60.00    59.94  
`;

const DESKTOP_XRANDR = `Screen 0: minimum 320 x 200, current 6400 x 2160, maximum 16384 x 16384
DP-1 disconnected (normal left inverted right x axis y axis)
HDMI-A-1 connected 2560x1440+3840+0 (normal left inverted right x axis y axis) 597mm x 336mm
   2560x1440     59.95*+
   1920x1080     60.00    59.94  
   1920x1080i    60.00  
DP-2 connected primary 3840x2160+0+0 (normal left inverted right x axis y axis) 697mm x 392mm
   3840x2160     60.00*+  30.00  
   2560x1440     59.95  
   1920x1080     60.00  
   1280x720      60.00  
`;

function pi3(): DisplayOutput {
    return parseXrandr(PI3_XRANDR)!;
}

describe('parseDisplayModeSetting', () => {
    it('keeps the known settings and reads anything else as auto', () => {
        expect(parseDisplayModeSetting('720p')).toBe('720p');
        expect(parseDisplayModeSetting('native')).toBe('native');
        expect(parseDisplayModeSetting(undefined)).toBe('auto');
        expect(parseDisplayModeSetting('4k')).toBe('auto');
    });
});

describe('parseXrandr', () => {
    it('reads the connected output, its current mode and its modes', () => {
        const output = pi3();
        expect(output.name).toBe('HDMI-1');
        expect(output.current).toEqual({width: 1152, height: 864});
        expect(output.modes).toHaveLength(12);
        expect(output.modes[0]).toEqual({width: 1920, height: 1080});
    });

    it('takes the primary output of several, without the interlaced modes nor those of other outputs', () => {
        const output = parseXrandr(DESKTOP_XRANDR)!;
        expect(output.name).toBe('DP-2');
        expect(output.current).toEqual({width: 3840, height: 2160});
        expect(output.modes.map(mode => mode.height)).toEqual([2160, 1440, 1080, 720]);
    });

    it('is null without a connected output', () => {
        expect(parseXrandr('')).toBeNull();
        expect(parseXrandr('DP-1 disconnected (normal left inverted right x axis y axis)\n')).toBeNull();
    });
});

describe('pickMode', () => {
    it('native never changes anything', () => {
        expect(pickMode('native', parseXrandr(DESKTOP_XRANDR)!, true)).toBeNull();
    });

    it('auto brings a screen above 1080 lines down to 1080', () => {
        expect(pickMode('auto', parseXrandr(DESKTOP_XRANDR)!, false)).toEqual({width: 1920, height: 1080});
    });

    it('auto leaves a screen already under its ceiling alone', () => {
        expect(pickMode('auto', pi3(), false)).toBeNull();
    });

    it('auto in Lite mode brings the screen down to 720 lines', () => {
        expect(pickMode('auto', pi3(), true)).toEqual({width: 1280, height: 720});
    });

    it('an explicit height is set even from a lower mode', () => {
        expect(pickMode('1080p', pi3(), true)).toEqual({width: 1920, height: 1080});
        expect(pickMode('720p', pi3(), false)).toEqual({width: 1280, height: 720});
    });

    it('falls back on the closest height under the one asked for', () => {
        const output: DisplayOutput = {
            name: 'VGA-1',
            current: {width: 1280, height: 1024},
            modes: [{width: 1280, height: 1024}, {width: 1024, height: 768}, {width: 800, height: 600}, {width: 640, height: 480}],
        };
        expect(pickMode('720p', output, false)).toEqual({width: 800, height: 600});
        expect(pickMode('1080p', output, false)).toBeNull();
    });

    it('is null when the screen is already in the mode asked for, or has none that fits', () => {
        const output: DisplayOutput = {name: 'HDMI-1', current: {width: 1280, height: 720}, modes: [{width: 1280, height: 720}]};
        expect(pickMode('720p', output, false)).toBeNull();
        expect(pickMode('720p', {name: 'HDMI-1', current: null, modes: [{width: 1920, height: 1080}]}, false)).toBeNull();
    });
});

describe('applyDisplayMode', () => {
    it('asks xrandr for the modes, then sets the one picked on that output', () => {
        const calls: string[][] = [];
        const mode = applyDisplayMode('auto', true, (file, args) => {
            calls.push([file, ...args]);
            return args[0] === '--query' ? PI3_XRANDR : '';
        });

        expect(mode).toEqual({width: 1280, height: 720});
        expect(calls).toEqual([
            ['xrandr', '--query'],
            ['xrandr', '--output', 'HDMI-1', '--mode', '1280x720'],
        ]);
    });

    it('does not set anything when there is nothing to change', () => {
        const calls: string[][] = [];
        expect(applyDisplayMode('auto', false, (file, args) => {
            calls.push([file, ...args]);
            return PI3_XRANDR;
        })).toBeNull();
        expect(calls).toHaveLength(1);
    });

    it('native does not even run xrandr', () => {
        expect(applyDisplayMode('native', true, () => {
            throw new Error('not expected');
        })).toBeNull();
    });
});
