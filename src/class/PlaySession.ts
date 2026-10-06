import {newRows, type TableRow} from '@/class/ScoreDiff';

// One game being played (maui-api Lot 2.3, "not retroactive"): the hiscore table is read when the
// game starts, then again each time MAME writes it (the hiscore plugin saves the .hi during the
// game) and once more when the game ends (nvram is only written then). Only the rows the game
// added since the start are reported, each once: the startup scan never sends anything.

export interface PlaySessionDeps {
    // Calls back on every write of the file; returns how to stop. None for nvram-only games.
    watch?: (onChange: () => void) => () => void;
    // MAME writes the file in several steps: wait for it to settle.
    debounceMs?: number;
    log?: (message: string) => void;
    // The default table now; null when it cannot be read (a damaged or foreign file).
    read(): Promise<TableRow[] | null>;
    report(rows: TableRow[]): Promise<void>;
}

const DEFAULT_DEBOUNCE_MS = 1500;

export class PlaySession {
    private snapshot: TableRow[] = [];
    private reported: TableRow[] = [];
    private stopWatching: (() => void) | null = null;
    private timer: ReturnType<typeof setTimeout> | null = null;
    // Reads one after the other: two checks must not report the same row twice.
    private queue: Promise<void> = Promise.resolve();

    public constructor(private readonly deps: PlaySessionDeps) {}

    public async start(): Promise<void> {
        this.snapshot = await this.deps.read() ?? [];
        this.stopWatching = this.deps.watch?.(() => this.schedule()) ?? null;
    }

    /** Stops watching, then checks the table a last time. */
    public async end(): Promise<void> {
        this.stopWatching?.();
        this.stopWatching = null;
        if (this.timer) {
            clearTimeout(this.timer);
            this.timer = null;
        }
        await this.check();
    }

    private schedule(): void {
        if (this.timer) {
            clearTimeout(this.timer);
        }
        this.timer = setTimeout(() => {
            this.timer = null;
            void this.check();
        }, this.deps.debounceMs ?? DEFAULT_DEBOUNCE_MS);
    }

    private check(): Promise<void> {
        this.queue = this.queue.then(async () => {
            const table = await this.deps.read();
            if (!table) {
                return;
            }
            const fresh = newRows(this.reported, newRows(this.snapshot, table));
            if (fresh.length === 0) {
                return;
            }
            this.reported.push(...fresh);
            await this.deps.report(fresh);
        }).catch(error => this.deps.log?.(`[scores] ${error instanceof Error ? error.message : String(error)}`));
        return this.queue;
    }
}
