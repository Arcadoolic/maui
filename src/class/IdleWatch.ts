/**
 * Tells when the front is left alone: no key nor button for a while on the list of games, with
 * nothing in the way. That is when Home.vue shows the messages of the cabinet (MessageBand.vue).
 * Left alone longer still, it falls asleep (optional `sleep`): the screen goes black, and off on a
 * dedicated cabinet (ScreenPower.ts), until the next key.
 *
 * The front reports every key (activity()) and whatever keeps it busy (block(): a game running, a
 * modal up). The key that wakes an idle or sleeping front is told apart: it only takes the messages
 * or the black screen away and must do nothing else.
 */
export interface SleepWatch {
    /** Once idle, time before falling asleep; from the last key when the front never turns idle. 0 or less, never. */
    delayMs: number;
    onChange: (asleep: boolean) => void;
}

export class IdleWatch {
    private timer: ReturnType<typeof setTimeout> | undefined;
    private idle = false;
    private asleep = false;
    private blocked = false;
    private started = false;

    /** delayMs: time without activity before the front is idle; 0 or less, never. */
    public constructor(
        private readonly delayMs: number,
        private readonly onChange: (idle: boolean) => void,
        private readonly sleep?: SleepWatch,
    ) {}

    public start(): void {
        this.started = true;
        this.arm();
    }

    public stop(): void {
        this.started = false;
        clearTimeout(this.timer);
        this.wake();
    }

    /** A key or a button. True when the front was idle or asleep: the key woke it up, and is not to act. */
    public activity(): boolean {
        const wasAway = this.idle || this.asleep;
        this.wake();
        this.arm();
        return wasAway;
    }

    /** While blocked the front is never idle; the delay starts again once it no longer is. */
    public block(blocked: boolean): void {
        if (blocked === this.blocked) {
            return;
        }
        this.blocked = blocked;
        if (blocked) {
            this.wake();
        }
        this.arm();
    }

    private arm(): void {
        clearTimeout(this.timer);
        if (!this.started || this.blocked) {
            return;
        }
        if (this.delayMs > 0) {
            this.timer = setTimeout(() => {
                this.setIdle(true);
                this.armSleep();
            }, this.delayMs);
        } else {
            this.armSleep();
        }
    }

    private armSleep(): void {
        if (this.sleep && this.sleep.delayMs > 0) {
            this.timer = setTimeout(() => this.setAsleep(true), this.sleep.delayMs);
        }
    }

    private wake(): void {
        this.setAsleep(false);
        this.setIdle(false);
    }

    private setIdle(idle: boolean): void {
        if (idle !== this.idle) {
            this.idle = idle;
            this.onChange(idle);
        }
    }

    private setAsleep(asleep: boolean): void {
        if (asleep !== this.asleep) {
            this.asleep = asleep;
            this.sleep?.onChange(asleep);
        }
    }
}
