import type Config from '@/class/Config.class';
import {VOTE_DOWN, VOTE_UP, type Vote} from '@/class/GameVote';

// The front's own sounds (MAUI-SOUNDS-PLAN.md): short runs of notes synthesized with Web Audio,
// arcade bleeps of the 80s, no file shipped. Set from the BO's MAUI tab (Config.uiSounds*).
// On a cabinet without a sound server, ALSA's default output goes through plug straight onto the
// card, without mixing: while Chromium keeps it open, MAME cannot open it and the game is silent.
// So the player is suspended while MAME runs, launched by the front (playThenSuspend()) or by the
// BO: its context closed, no note played until resume(). Asleep, the front only closes it
// (release()): the next note makes another.

export type UiSoundName = 'move' | 'category' | 'alphaJump' | 'launch' | 'back'
    | 'voteUp' | 'voteDown' | 'star' | 'newPlayer' | 'champion' | 'wake' | 'updated';

export interface UiNote {
    freq: number;
    ms: number;
    wave: OscillatorType;
    // Relative to the others, 1 = the loudest.
    gain: number;
    // The frequency the note slides to, when it slides.
    slideTo?: number;
}

export interface UiSound {
    notes: UiNote[];
    // A navigation sound: switched off on its own in the BO, and never over another sound.
    navigation: boolean;
}

export const UI_SOUNDS: Record<UiSoundName, UiSound> = {
    move: {navigation: true, notes: [{freq: 1760, ms: 15, wave: 'square', gain: 0.3}]},
    category: {navigation: true, notes: [{freq: 440, ms: 80, wave: 'triangle', gain: 0.7, slideTo: 880}]},
    alphaJump: {navigation: true, notes: [{freq: 2349, ms: 20, wave: 'square', gain: 0.35}]},
    // "Insert coin": two notes up, then held.
    launch: {navigation: false, notes: [
        {freq: 659, ms: 60, wave: 'square', gain: 0.8},
        {freq: 988, ms: 60, wave: 'square', gain: 0.8},
        {freq: 1319, ms: 280, wave: 'square', gain: 1},
    ]},
    back: {navigation: false, notes: [
        {freq: 659, ms: 60, wave: 'triangle', gain: 0.8},
        {freq: 880, ms: 90, wave: 'triangle', gain: 0.8},
    ]},
    voteUp: {navigation: false, notes: [
        {freq: 1047, ms: 60, wave: 'square', gain: 0.7},
        {freq: 1319, ms: 60, wave: 'square', gain: 0.7},
        {freq: 1568, ms: 120, wave: 'square', gain: 0.7},
    ]},
    voteDown: {navigation: false, notes: [
        {freq: 523, ms: 120, wave: 'triangle', gain: 0.8},
        {freq: 392, ms: 200, wave: 'triangle', gain: 0.8},
    ]},
    // A sparkle: up and down quickly, high.
    star: {navigation: false, notes: [
        {freq: 1568, ms: 40, wave: 'square', gain: 0.5},
        {freq: 2093, ms: 40, wave: 'square', gain: 0.5},
        {freq: 2637, ms: 40, wave: 'square', gain: 0.5},
        {freq: 3136, ms: 40, wave: 'square', gain: 0.5},
        {freq: 2637, ms: 40, wave: 'square', gain: 0.5},
        {freq: 3136, ms: 120, wave: 'square', gain: 0.5},
    ]},
    // "1UP".
    newPlayer: {navigation: false, notes: [
        {freq: 784, ms: 60, wave: 'square', gain: 0.7},
        {freq: 988, ms: 60, wave: 'square', gain: 0.7},
        {freq: 1175, ms: 60, wave: 'square', gain: 0.7},
        {freq: 1568, ms: 200, wave: 'square', gain: 0.8},
    ]},
    // A short fanfare: the cabinet's best score on a game went up.
    champion: {navigation: false, notes: [
        {freq: 784, ms: 100, wave: 'square', gain: 0.8},
        {freq: 784, ms: 100, wave: 'square', gain: 0.8},
        {freq: 784, ms: 100, wave: 'square', gain: 0.8},
        {freq: 1047, ms: 300, wave: 'square', gain: 1},
        {freq: 988, ms: 100, wave: 'square', gain: 0.8},
        {freq: 1047, ms: 300, wave: 'square', gain: 1},
    ]},
    // Power on: up an arpeggio from low.
    wake: {navigation: false, notes: [
        {freq: 262, ms: 80, wave: 'triangle', gain: 0.8},
        {freq: 392, ms: 80, wave: 'triangle', gain: 0.8},
        {freq: 523, ms: 80, wave: 'triangle', gain: 0.8},
        {freq: 784, ms: 260, wave: 'triangle', gain: 0.9},
    ]},
    updated: {navigation: false, notes: [
        {freq: 1047, ms: 80, wave: 'square', gain: 0.7},
        {freq: 1319, ms: 80, wave: 'square', gain: 0.7},
        {freq: 1568, ms: 80, wave: 'square', gain: 0.7},
        {freq: 2093, ms: 260, wave: 'square', gain: 0.8},
    ]},
};

// A hotkey held: one note rising with the loader until the hotkey goes off or is let go.
const CHARGE = {from: 220, to: 880, wave: 'triangle' as OscillatorType, gain: 0.5};

export interface UiSoundSettings {
    enabled: boolean;
    // 0 to 100.
    volume: number;
    navigation: boolean;
}

// Square waves are loud: 100% in the BO is this much of the output's full scale.
const FULL_SCALE = 0.25;
// A held direction scrolls a game every 150 ms: no more than a tick every this often.
const NAVIGATION_MIN_GAP_MS = 60;

export const DEFAULT_UI_SOUNDS_VOLUME = 60;

export function uiSoundSettings(config: Config): UiSoundSettings {
    return {enabled: config.uiSoundsEnabled, volume: config.uiSoundsVolume, navigation: config.uiSoundsNavigation};
}

/** The sound of a vote given on the cabinet: none for a neutral one, which saves nothing. */
export function voteSound(vote: Vote, starred: boolean): UiSoundName | null {
    if (starred) {
        return 'star';
    }
    return vote === VOTE_UP ? 'voteUp' : vote === VOTE_DOWN ? 'voteDown' : null;
}

/** How long a sound lasts. */
export function uiSoundMs(name: UiSoundName): number {
    return UI_SOUNDS[name].notes.reduce((total, note) => total + note.ms, 0);
}

type ContextFactory = () => AudioContext;

export class UiSoundPlayer {
    private settings: UiSoundSettings = {enabled: false, volume: DEFAULT_UI_SOUNDS_VOLUME, navigation: false};
    private context: AudioContext | undefined;
    // Until when another sound plays, and when the last navigation tick played.
    private busyUntil = 0;
    private lastNavigation = -Infinity;
    private suspended = false;
    private charge: {oscillator: OscillatorNode; gain: GainNode} | undefined;

    constructor(
        private readonly createContext: ContextFactory = () => new AudioContext(),
        private readonly now: () => number = () => Date.now(),
    ) {
    }

    public setSettings(settings: UiSoundSettings): void {
        this.settings = settings;
    }

    public play(name: UiSoundName): void {
        if (!this.settings.enabled || this.suspended || !this.allowed(name)) {
            return;
        }
        this.schedule(name, this.settings.volume);
    }

    /** The BO's "Test on the cabinet": the launch sound at the form's volume, even switched off. */
    public test(volume: number): void {
        if (!this.suspended) {
            this.schedule('launch', volume);
        }
    }

    /** Plays `name` and resolves once it is over, at once when it does not play. */
    public async playAndWait(name: UiSoundName): Promise<void> {
        if (!this.settings.enabled || this.suspended) {
            return;
        }
        this.play(name);
        await new Promise(resolve => setTimeout(resolve, uiSoundMs(name)));
    }

    /** The hotkey charge, rising over `ms` until stopCharge(). */
    public startCharge(ms: number): void {
        this.stopCharge();
        if (!this.settings.enabled || this.suspended || this.settings.volume <= 0) {
            return;
        }
        this.context ??= this.createContext();
        const context = this.context;
        const start = context.currentTime;
        const oscillator = context.createOscillator();
        oscillator.type = CHARGE.wave;
        oscillator.frequency.setValueAtTime(CHARGE.from, start);
        oscillator.frequency.linearRampToValueAtTime(CHARGE.to, start + ms / 1000);
        const gain = context.createGain();
        gain.gain.setValueAtTime(FULL_SCALE * CHARGE.gain * this.settings.volume / 100, start);
        oscillator.connect(gain).connect(context.destination);
        oscillator.start(start);
        this.charge = {oscillator, gain};
    }

    public stopCharge(): void {
        const charge = this.charge;
        this.charge = undefined;
        if (!charge || !this.context) {
            return;
        }
        // Faded out in 30 ms rather than cut, which clicks.
        const end = this.context.currentTime + 0.03;
        charge.gain.gain.exponentialRampToValueAtTime(0.0001, end);
        charge.oscillator.stop(end);
    }

    /** Plays `name`, then suspends the player once it is over: a game is about to start. */
    public async playThenSuspend(name: UiSoundName): Promise<void> {
        if (this.settings.enabled && !this.suspended) {
            this.schedule(name, this.settings.volume);
            await new Promise(resolve => setTimeout(resolve, uiSoundMs(name)));
        }
        this.suspend();
    }

    /** MAME runs: the sound card is let go, and nothing plays until resume(). */
    public suspend(): void {
        this.suspended = true;
        this.release();
    }

    public resume(): void {
        this.suspended = false;
    }

    /** Closes the context, which lets the sound card go. The next note makes another. */
    public release(): void {
        const context = this.context;
        this.context = undefined;
        this.charge = undefined;
        this.busyUntil = 0;
        context?.close().catch(() => undefined);
    }

    private allowed(name: UiSoundName): boolean {
        if (!UI_SOUNDS[name].navigation) {
            return true;
        }
        const now = this.now();
        if (!this.settings.navigation || now < this.busyUntil || now - this.lastNavigation < NAVIGATION_MIN_GAP_MS) {
            return false;
        }
        this.lastNavigation = now;
        return true;
    }

    private schedule(name: UiSoundName, volume: number): void {
        const sound = UI_SOUNDS[name];
        if (!sound.navigation) {
            this.busyUntil = this.now() + uiSoundMs(name);
        }
        if (volume <= 0) {
            return;
        }
        this.context ??= this.createContext();
        const context = this.context;
        let start = context.currentTime;
        for (const note of sound.notes) {
            const end = start + note.ms / 1000;
            const oscillator = context.createOscillator();
            oscillator.type = note.wave;
            oscillator.frequency.setValueAtTime(note.freq, start);
            if (note.slideTo) {
                oscillator.frequency.linearRampToValueAtTime(note.slideTo, end);
            }
            const gain = context.createGain();
            gain.gain.setValueAtTime(FULL_SCALE * note.gain * volume / 100, start);
            // Down to almost nothing by the end of the note, without a click.
            gain.gain.exponentialRampToValueAtTime(0.0001, end);
            oscillator.connect(gain).connect(context.destination);
            oscillator.start(start);
            oscillator.stop(end);
            start = end;
        }
    }
}

/** The front's player (Home.vue). */
export const uiSounds = new UiSoundPlayer();
