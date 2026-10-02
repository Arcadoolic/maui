import {existsSync, mkdirSync, watch} from 'fs';
import {join} from 'path';
import {MameHiExtractor} from '@arcadoolic/mhiex';
import {PlaySession} from '@/class/PlaySession';
import {queueScores, type PublishablePlayer, type ScoreStore} from '@/class/ScoreOutbox';
import type {TableRow} from '@/class/ScoreDiff';

// The games played on this cabinet, in ONLINE mode (maui-api Lot 2.3): one PlaySession per game,
// started and ended by the front (Home.vue, through background.ts). The scores it finds go to the
// outbox, then to MAUI-API right away.

export interface ScoreCaptureDeps {
    store: ScoreStore;
    log?: (message: string) => void;
    mameHome(): string;
    // ONLINE turned on: nothing is captured otherwise.
    enabled(): boolean;
    players(): Promise<PublishablePlayer[]>;
    startupId(): string | null;
    // Sends what the outbox holds (OnlineSession.flushScoresNow()).
    flush(): void;
}

/** The default table of a game, [] before its first file exists, null when it cannot be read. */
async function readTable(extractor: MameHiExtractor, romname: string): Promise<TableRow[] | null> {
    try {
        const read = await extractor.get(romname);
        return read ? read.extract(false).scores.default : null;
    } catch (error) {
        return (error as NodeJS.ErrnoException).code === 'ENOENT' ? [] : null;
    }
}

/** Watches <mame home>/hiscore for the game's .hi: the hiscore plugin rewrites it during the game. */
function watchHiscoreFile(mameHome: string, romname: string, onChange: () => void): () => void {
    const dir = join(mameHome, 'hiscore');
    if (!existsSync(dir)) {
        mkdirSync(dir, {recursive: true});
    }
    const watcher = watch(dir, (event, filename) => {
        if (filename === `${romname}.hi`) {
            onChange();
        }
    });
    return () => watcher.close();
}

export class ScoreCapture {
    private readonly sessions = new Map<string, PlaySession>();

    public constructor(private readonly deps: ScoreCaptureDeps) {}

    /** A game starts: the table as it is now is the baseline. Never throws. */
    public async started(romname: string): Promise<void> {
        if (!this.deps.enabled() || this.sessions.has(romname)) {
            return;
        }
        const mameHome = this.deps.mameHome();
        const extractor = new MameHiExtractor(mameHome);
        const files = extractor.files(romname);
        if (!files) {
            return;
        }
        const session = new PlaySession({
            read: () => readTable(extractor, romname),
            watch: files.hi ? onChange => watchHiscoreFile(mameHome, romname, onChange) : undefined,
            report: rows => this.queue(romname, rows),
            log: this.deps.log,
        });
        this.sessions.set(romname, session);
        try {
            await session.start();
        } catch (error) {
            this.sessions.delete(romname);
            this.deps.log?.(`[scores] ${romname} not captured: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    /** The game ended: a last look at its table. Never throws. */
    public async ended(romname: string): Promise<void> {
        const session = this.sessions.get(romname);
        this.sessions.delete(romname);
        await session?.end();
    }

    private async queue(romname: string, rows: TableRow[]): Promise<void> {
        const queued = await queueScores(this.deps.store, await this.deps.players(), rows, {
            romname, achievedAt: new Date().toISOString(), startupId: this.deps.startupId(),
        });
        if (queued.length > 0) {
            this.deps.log?.(`[scores] ${romname}: ${queued.length} score(s) queued for MAUI-API.`);
            this.deps.flush();
        }
    }
}
