import {closeSync, constants, openSync, readdirSync, readFileSync, readSync, realpathSync} from 'fs';
import {dirname, join} from 'path';

/**
 * Linux arcade encoders wired for two players (Xin-Mo Dual Arcade, 16c0:05e1) come out of the
 * kernel as several joysticks (js0, js1) under one HID device. Chromium tells gamepads apart by
 * the path of that HID device (device/gamepad/udev_gamepad_linux.cc: the parent input node's
 * syspath, cut at its first "input"), so it takes them for one and the same pad: each joystick it
 * opens replaces the previous one, and only the last (player 2's) ever reaches the Gamepad API.
 *
 * The joysticks Chromium merges are read here instead, straight from /dev/input/js*, and
 * Gamepads.class.ts leaves out what the Gamepad API reports for their model. Controllers with a
 * HID device of their own (separate USB or Bluetooth pads) are not touched: Chromium sees each of
 * them and gives them its standard mappings.
 */

/** One /dev/input/jsN as sysfs describes it. */
export interface JoystickNode {
    number: number;
    devicePath: string;
    /** What Chromium identifies the gamepad by: two nodes with the same key are merged. */
    chromiumKey: string;
    name: string;
    vendorId: string;
    productId: string;
}

/** The shape Gamepads.class.ts polls, met by both a browser Gamepad and a JoydevPad. */
export interface PolledPad {
    readonly index: number;
    readonly id: string;
    readonly mapping: string;
    readonly axes: readonly number[];
    readonly buttons: ReadonlyArray<{pressed: boolean, value: number}>;
}

// struct js_event (linux/joystick.h): __u32 time, __s16 value, __u8 type, __u8 number.
const JS_EVENT_SIZE = 8;
const JS_EVENT_BUTTON = 0x01;
const JS_EVENT_AXIS = 0x02;
const JS_EVENT_INIT = 0x80;
const AXIS_MAX = 32767;
// Kept apart from the Gamepad API's indexes (0-3) in Gamepads.gamepadKeyPressed.
const INDEX_OFFSET = 1000;

/** Chromium's key: the input node's syspath up to its first "input" (udev_gamepad_linux.cc). */
export function chromiumKey(inputSyspath: string): string {
    const at = inputSyspath.indexOf('input');
    return at === -1 ? inputSyspath : inputSyspath.slice(0, at);
}

/** Every joystick sysfs lists, skipping any it cannot describe (unplugged while being read). */
export function listJoysticks(classDir = '/sys/class/input'): JoystickNode[] {
    let entries: string[];
    try {
        entries = readdirSync(classDir).filter((entry) => /^js\d+$/.test(entry));
    } catch {
        return [];
    }
    const nodes: JoystickNode[] = [];
    for (const entry of entries) {
        try {
            const inputDir = dirname(realpathSync(join(classDir, entry)));
            nodes.push({
                number: Number(entry.slice(2)),
                devicePath: `/dev/input/${entry}`,
                chromiumKey: chromiumKey(inputDir),
                name: readFileSync(join(inputDir, 'name'), 'utf8').trim(),
                vendorId: readFileSync(join(inputDir, 'id', 'vendor'), 'utf8').trim(),
                productId: readFileSync(join(inputDir, 'id', 'product'), 'utf8').trim(),
            });
        } catch {
            continue;
        }
    }
    return nodes.sort((a, b) => a.number - b.number);
}

function modelOf(node: {vendorId: string, productId: string}): string {
    return `${node.vendorId}:${node.productId}`.toLowerCase();
}

/**
 * The joysticks to read here: those Chromium merges with another one, and every other joystick of
 * the same model, so that one model is never read half through each path (the Gamepad API's pads
 * are left out by model: its id has no more than the name, vendor and product).
 */
export function findSharedJoysticks(nodes: JoystickNode[]): JoystickNode[] {
    const countByKey = new Map<string, number>();
    for (const node of nodes) {
        countByKey.set(node.chromiumKey, (countByKey.get(node.chromiumKey) ?? 0) + 1);
    }
    const sharedModels = new Set(nodes.filter((node) => countByKey.get(node.chromiumKey)! > 1).map(modelOf));
    return nodes.filter((node) => sharedModels.has(modelOf(node)));
}

/** Applies a run of js_event records to a joystick's state. */
export function applyJoydevEvents(data: Buffer, length: number, axes: number[], buttons: boolean[]): void {
    for (let offset = 0; offset + JS_EVENT_SIZE <= length; offset += JS_EVENT_SIZE) {
        const value = data.readInt16LE(offset + 4);
        const type = data[offset + 6] & ~JS_EVENT_INIT;
        const number = data[offset + 7];
        if (type === JS_EVENT_BUTTON) {
            buttons[number] = value !== 0;
        } else if (type === JS_EVENT_AXIS) {
            axes[number] = Math.max(-1, value / AXIS_MAX);
        }
    }
}

/** A joystick read from its /dev/input/jsN, opened non-blocking and drained at each poll. */
export class JoydevPad implements PolledPad {
    public readonly mapping = '';
    public readonly axes: number[] = [];
    protected readonly pressed: boolean[] = [];
    protected readonly chunk = Buffer.alloc(JS_EVENT_SIZE * 64);

    public constructor(public readonly node: JoystickNode, protected readonly fd: number) {}

    public get index(): number {
        return INDEX_OFFSET + this.node.number;
    }

    /** The id Chromium would give it (gamepad_data_fetcher.cc), so controllers.json applies. */
    public get id(): string {
        return `${this.node.name} (Vendor: ${this.node.vendorId} Product: ${this.node.productId})`;
    }

    public get buttons(): Array<{pressed: boolean, value: number}> {
        return Array.from(this.pressed, (pressed) => ({pressed: !!pressed, value: pressed ? 1 : 0}));
    }

    /**
     * Applies what the kernel queued since the last call. False once the joystick is gone. A
     * queue that overflowed (nobody read it while a game ran) is no harm: joydev then sends the
     * whole state again.
     */
    public drain(): boolean {
        for (;;) {
            let length: number;
            try {
                length = readSync(this.fd, this.chunk, 0, this.chunk.length, null);
            } catch (error) {
                return (error as NodeJS.ErrnoException).code === 'EAGAIN';
            }
            if (length === 0) {
                return true;
            }
            applyJoydevEvents(this.chunk, length, this.axes, this.pressed);
        }
    }

    public close(): void {
        try {
            closeSync(this.fd);
        } catch {
            // Already gone with the device.
        }
    }
}

export type OpenJoystick = (devicePath: string) => number;

const openNonBlocking: OpenJoystick = (devicePath) => openSync(devicePath, constants.O_RDONLY | constants.O_NONBLOCK);

/** The joysticks Chromium merges, kept open and read for Gamepads.class.ts. */
export class SharedJoysticks {
    protected readonly pads = new Map<string, JoydevPad>();
    protected models = new Set<string>();

    public constructor(
        protected readonly classDir = '/sys/class/input',
        protected readonly open: OpenJoystick = openNonBlocking,
    ) {}

    /** Looks for joysticks plugged in or out since the last call. */
    public refresh(): void {
        const shared = findSharedJoysticks(listJoysticks(this.classDir));
        this.models = new Set(shared.map(modelOf));
        const wanted = new Set(shared.map((node) => node.devicePath));
        for (const [devicePath, pad] of this.pads) {
            if (!wanted.has(devicePath)) {
                pad.close();
                this.pads.delete(devicePath);
            }
        }
        const unreadableModels = new Set<string>();
        for (const node of shared) {
            if (this.pads.has(node.devicePath)) {
                continue;
            }
            try {
                this.pads.set(node.devicePath, new JoydevPad(node, this.open(node.devicePath)));
            } catch {
                unreadableModels.add(modelOf(node));
            }
        }
        // A model is read wholly here or not at all: one of its joysticks this user cannot open
        // leaves the whole model to the Gamepad API, which keeps what it can of it.
        for (const [devicePath, pad] of this.pads) {
            if (unreadableModels.has(modelOf(pad.node))) {
                pad.close();
                this.pads.delete(devicePath);
            }
        }
        unreadableModels.forEach((model) => this.models.delete(model));
    }

    /** Whether a Gamepad API pad (by its id) is of a model read here, and must be left out. */
    public handles(gamepadId: string): boolean {
        const ids = /Vendor: ([0-9a-f]{4}) Product: ([0-9a-f]{4})/i.exec(gamepadId);
        return !!ids && this.models.has(`${ids[1]}:${ids[2]}`.toLowerCase());
    }

    /** The joysticks open, without reading them. */
    public list(): JoydevPad[] {
        return [...this.pads.values()];
    }

    /** Reads every joystick, dropping those unplugged. */
    public read(): JoydevPad[] {
        for (const [devicePath, pad] of this.pads) {
            if (!pad.drain()) {
                pad.close();
                this.pads.delete(devicePath);
            }
        }
        return this.list();
    }
}
