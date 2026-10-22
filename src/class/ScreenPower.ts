import {execFile} from 'child_process';
import {isKioskLayout} from '@/class/KioskRestart';

// The screen of a dedicated cabinet asleep (IdleWatch.ts): switched off through DPMS, back on at the
// next key. Only on the kiosk layout under X11, like DisplayMode.ts: a desktop's screen is never
// touched. The kiosk's ~/.xinitrc turns DPMS off (maui-cabinets' xinitrc.j2) and `xset dpms force`
// turns it back on to do its job, with X's own timeouts: put back off once the screen is on, or X
// would blank it in the middle of a game played with a gamepad, which X never hears of.

type ExecFile = (file: string, args: string[], options: {timeout: number}, callback: (error: Error | null) => void) => unknown;

export function canSwitchScreenOff(
    isPackaged: boolean, env: NodeJS.ProcessEnv = process.env, platform: string = process.platform,
): boolean {
    return isKioskLayout(isPackaged, platform) && !!env.DISPLAY && !env.WAYLAND_DISPLAY;
}

function xset(args: string[], exec: ExecFile): Promise<void> {
    return new Promise((resolve, reject) => {
        exec('xset', args, {timeout: 5000}, error => error ? reject(error) : resolve());
    });
}

/** Rejects with what xset says (missing, no X server): the caller logs it, the front carries on. */
export async function setScreenPower(on: boolean, exec: ExecFile = execFile as ExecFile): Promise<void> {
    if (on) {
        await xset(['dpms', 'force', 'on'], exec);
        await xset(['-dpms'], exec);
    } else {
        await xset(['dpms', 'force', 'off'], exec);
    }
}
