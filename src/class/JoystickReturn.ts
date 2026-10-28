import {listJoysticks, type JoystickNode} from '@/class/SharedJoysticks';

/**
 * MAME lists the joysticks once, when the game starts, and never sees one plugged in later. A
 * joystick lost during a game and back (a wireless stick that fell asleep and woke up, a cable
 * pulled out and plugged again, arcade-digdug 2026-10-28) is a new device to Linux: MAME no longer
 * reads it, not even its button to quit, and the game can only be left from the BO.
 *
 * Watched here while a game runs, from sysfs: when a joystick of the model of one lost comes back,
 * `onReturn` is told, once, and MameService quits the game the usual way (SIGQUIT, scores saved).
 * A new joystick of another model changes nothing: MAME does not read it, but the game goes on
 * with those it has. Linux only, like /sys/class/input.
 */

/** How often sysfs is read, in milliseconds. */
const POLL_MS = 1000;

function modelOf(node: JoystickNode): string {
    return `${node.vendorId}:${node.productId}:${node.name}`.toLowerCase();
}

export class JoystickReturn {
    /** The joysticks MAME has, by input node, with their model. */
    private readonly known: Map<string, string>;
    /** The models of those lost since the game started. */
    private readonly lost = new Set<string>();

    public constructor(atLaunch: JoystickNode[]) {
        this.known = new Map(atLaunch.map((node) => [node.inputPath, modelOf(node)]));
    }

    /** Takes in the joysticks there are now; tells whether one lost during the game is back. */
    public update(nodes: JoystickNode[]): boolean {
        const present = new Set(nodes.map((node) => node.inputPath));
        for (const [inputPath, model] of this.known) {
            if (!present.has(inputPath)) {
                this.known.delete(inputPath);
                this.lost.add(model);
            }
        }
        return nodes.some((node) => !this.known.has(node.inputPath) && this.lost.has(modelOf(node)));
    }
}

/** Watches the joysticks until stopped (the function returned), or until one is back. */
export function watchJoystickReturn(onReturn: () => void, classDir?: string, pollMs = POLL_MS): () => void {
    if (process.platform !== 'linux') {
        return () => {};
    }
    const watch = new JoystickReturn(listJoysticks(classDir));
    const timer = setInterval(() => {
        if (watch.update(listJoysticks(classDir))) {
            clearInterval(timer);
            onReturn();
        }
    }, pollMs);
    return () => clearInterval(timer);
}
