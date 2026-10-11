/**
 * Tells when the front is left alone: no key nor button for a while on the list of games, with
 * nothing in the way. That is when Home.vue shows the messages of the cabinet (MessageBand.vue).
 *
 * The front reports every key (activity()) and whatever keeps it busy (block(): a game running, a
 * modal up). The key that wakes an idle front is told apart: it only takes the messages away and
 * must do nothing else.
 */
export class IdleWatch {
    private timer: ReturnType<typeof setTimeout> | undefined;
    private idle = false;
    private blocked = false;
    private started = false;

    /** delayMs: time without activity before the front is idle; 0 or less, never. */
    public constructor(private readonly delayMs: number, private readonly onChange: (idle: boolean) => void) {}

    public start(): void {
        this.started = true;
        this.arm();
    }

    public stop(): void {
        this.started = false;
        clearTimeout(this.timer);
        this.setIdle(false);
    }

    /** A key or a button. True when the front was idle: the key woke it up, and is not to act. */
    public activity(): boolean {
        const wasIdle = this.idle;
        this.setIdle(false);
        this.arm();
        return wasIdle;
    }

    /** While blocked the front is never idle; the delay starts again once it no longer is. */
    public block(blocked: boolean): void {
        if (blocked === this.blocked) {
            return;
        }
        this.blocked = blocked;
        if (blocked) {
            this.setIdle(false);
        }
        this.arm();
    }

    private arm(): void {
        clearTimeout(this.timer);
        if (!this.started || this.blocked || this.delayMs <= 0) {
            return;
        }
        this.timer = setTimeout(() => this.setIdle(true), this.delayMs);
    }

    private setIdle(idle: boolean): void {
        if (idle !== this.idle) {
            this.idle = idle;
            this.onChange(idle);
        }
    }
}
