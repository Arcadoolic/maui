import {describe, it, expect, beforeEach, vi, afterEach} from 'vitest';
import {UI_SOUNDS, UiSoundPlayer, uiSoundMs, voteSound, type UiSoundName} from '@/class/UiSounds';
import {VOTE_DOWN, VOTE_NEUTRAL, VOTE_UP} from '@/class/GameVote';

// What the player does with a context: the notes started, their peak gain, and whether it closed.
class FakeContext {
    public currentTime = 0;
    public destination = {};
    public notes: {freq: number; gain: number}[] = [];
    public closed = false;
    public stopped = 0;

    public createOscillator() {
        const note = {freq: 0, gain: 0};
        return {
            type: '',
            frequency: {setValueAtTime: (freq: number) => {
                note.freq = freq;
            }, linearRampToValueAtTime: () => undefined},
            connect: (gain: {note?: typeof note}) => {
                gain.note = note;
                return gain;
            },
            start: () => this.notes.push(note),
            stop: () => {
                this.stopped += 1;
            },
        };
    }

    public createGain() {
        const gain: {note?: {gain: number}; gain: object; connect: () => void} = {
            gain: {
                setValueAtTime: (value: number) => {
                    if (gain.note) {
                        gain.note.gain = value;
                    }
                },
                exponentialRampToValueAtTime: () => undefined,
            },
            connect: () => undefined,
        };
        return gain;
    }

    public close() {
        this.closed = true;
        return Promise.resolve();
    }
}

const ON = {enabled: true, volume: 100, navigation: true};

describe('UiSoundPlayer', () => {
    let now: number;
    let contexts: FakeContext[];
    let player: UiSoundPlayer;
    const played = () => contexts.flatMap(context => context.notes);

    beforeEach(() => {
        now = 1000;
        contexts = [];
        player = new UiSoundPlayer(() => {
            const context = new FakeContext();
            contexts.push(context);
            return context as unknown as AudioContext;
        }, () => now);
        player.setSettings(ON);
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('plays the notes of a sound, at the volume set', () => {
        player.play('back');
        expect(played().map(note => note.freq)).toEqual(UI_SOUNDS.back.notes.map(note => note.freq));
        const loud = played()[0].gain;
        player.setSettings({...ON, volume: 50});
        player.play('back');
        expect(played()[2].gain).toBeCloseTo(loud / 2);
    });

    it('plays nothing switched off, at a volume of 0, nor makes a context then', () => {
        player.setSettings({...ON, enabled: false});
        player.play('launch');
        player.setSettings({...ON, volume: 0});
        player.play('launch');
        expect(contexts).toHaveLength(0);
    });

    it('leaves out the navigation sounds alone when the BO says so', () => {
        player.setSettings({...ON, navigation: false});
        player.play('move');
        player.play('category');
        player.play('back');
        expect(played()).toHaveLength(UI_SOUNDS.back.notes.length);
    });

    it('plays no navigation tick over another sound, nor two ticks too close', () => {
        player.play('launch');
        now += uiSoundMs('launch') - 1;
        player.play('move');
        expect(played()).toHaveLength(UI_SOUNDS.launch.notes.length);
        now += 1;
        player.play('move');
        now += 30;
        player.play('move');
        now += 30;
        player.play('alphaJump');
        expect(played()).toHaveLength(UI_SOUNDS.launch.notes.length + 2);
    });

    it('lets the sound card go before a game, and plays nothing until it is over', async () => {
        vi.useFakeTimers();
        const launched = player.playThenSuspend('launch');
        expect(contexts[0].closed).toBe(false);
        await vi.advanceTimersByTimeAsync(uiSoundMs('launch'));
        await launched;
        expect(contexts[0].closed).toBe(true);
        player.play('back');
        player.test(80);
        expect(contexts).toHaveLength(1);
        player.resume();
        player.play('back');
        expect(contexts).toHaveLength(2);
    });

    it('closes its context when asked, and makes another at the next note', () => {
        player.play('back');
        player.release();
        expect(contexts[0].closed).toBe(true);
        player.play('back');
        expect(contexts).toHaveLength(2);
    });

    it('waits for a sound to be over, not for one that does not play', async () => {
        vi.useFakeTimers();
        let over = false;
        void player.playAndWait('champion').then(() => {
            over = true;
        });
        await vi.advanceTimersByTimeAsync(uiSoundMs('champion') - 1);
        expect(over).toBe(false);
        await vi.advanceTimersByTimeAsync(1);
        expect(over).toBe(true);
        player.setSettings({...ON, enabled: false});
        await player.playAndWait('champion');
    });

    it('rises a note while a hotkey is held, and stops it when let go', () => {
        player.startCharge(2000);
        expect(played().map(note => note.freq)).toEqual([220]);
        player.stopCharge();
        player.stopCharge();
        expect(contexts[0].stopped).toBe(1);
        player.setSettings({...ON, enabled: false});
        player.startCharge(2000);
        expect(played()).toHaveLength(1);
    });

    it('plays the test sound even switched off', () => {
        player.setSettings({...ON, enabled: false});
        player.test(40);
        expect(played()).toHaveLength(UI_SOUNDS.launch.notes.length);
    });
});

describe('the sounds', () => {
    it('stay short and audible', () => {
        for (const name of Object.keys(UI_SOUNDS) as UiSoundName[]) {
            // The champion's fanfare is the longest, about a second.
            expect(uiSoundMs(name)).toBeLessThanOrEqual(1000);
            for (const note of UI_SOUNDS[name].notes) {
                expect(note.freq).toBeGreaterThanOrEqual(100);
                expect(note.freq).toBeLessThanOrEqual(5000);
                expect(note.gain).toBeGreaterThan(0);
                expect(note.gain).toBeLessThanOrEqual(1);
            }
        }
    });
});

describe('voteSound', () => {
    it('plays the star over the thumbs up it goes with, nothing for a neutral vote', () => {
        expect(voteSound(VOTE_UP, true)).toBe('star');
        expect(voteSound(VOTE_UP, false)).toBe('voteUp');
        expect(voteSound(VOTE_DOWN, false)).toBe('voteDown');
        expect(voteSound(VOTE_NEUTRAL, false)).toBeNull();
    });
});
