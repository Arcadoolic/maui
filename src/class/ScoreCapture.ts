import {existsSync, mkdirSync, watch} from 'fs';
import {join} from 'path';
import {MameHiExtractor} from '@arcadoolic/mhiex';
import {PlaySession} from '@/class/PlaySession';
import {queueScores, type PublishablePlayer, type ScoreStore} from '@/class/ScoreOutbox';
import {ScoreDeclarations} from '@/class/ScoreDeclaration';
import type {PendingAttribution} from '@/class/ScoreCaptureBridge';
import type {TableRow} from '@/class/ScoreDiff';

// The games played on this cabinet, in ONLINE mode (maui-api Lot 2.3): one PlaySession per game,
// started and ended by the front (Home.vue, through background.ts). The scores it finds go to the
// outbox, then to MAUI-API right away. Those the game wrote without a name wait for the game to
// end: ScoreDeclaration.ts then says whose they are, or what to ask on the cabinet.

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
    // How to read the table of each game being played, for a last look when it ends.
    private readonly readers = new Map<string, () => Promise<TableRow[] | null>>();
    private readonly declarations: ScoreDeclarations;

    public constructor(private readonly deps: ScoreCaptureDeps) {
        this.declarations = new ScoreDeclarations({store: deps.store, players: deps.players});
    }

    /** A game starts: the table as it is now is the baseline. Never throws. */
    public async started(romname: string): Promise<void> {
        if (!this.deps.enabled() || this.sessions.has(romname)) {
            return;
        }
        this.declarations.reset(romname);
        const mameHome = this.deps.mameHome();
        const extractor = new MameHiExtractor(mameHome);
        const files = extractor.files(romname);
        if (!files) {
            return;
        }
        const read = () => readTable(extractor, romname);
        this.readers.set(romname, read);
        const session = new PlaySession({
            read,
            watch: files.hi ? onChange => watchHiscoreFile(mameHome, romname, onChange) : undefined,
            report: rows => this.queue(romname, rows),
            log: this.deps.log,
        });
        this.sessions.set(romname, session);
        try {
            await session.start();
        } catch (error) {
            this.sessions.delete(romname);
            this.readers.delete(romname);
            this.deps.log?.(`[scores] ${romname} not captured: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    /**
     * The game ended: a last look at its table, then its nameless scores. Returns those to ask
     * about on the cabinet, null when there is none. Never throws.
     */
    public async ended(romname: string): Promise<PendingAttribution | null> {
        const session = this.sessions.get(romname);
        this.sessions.delete(romname);
        await session?.end();
        const read = this.readers.get(romname);
        this.readers.delete(romname);
        try {
            // The table as the game left it: what it held on the way up is not asked about.
            const {queued, ask} = await this.declarations.settle(romname, await read?.() ?? null);
            this.sent(romname, queued);
            return ask;
        } catch (error) {
            this.deps.log?.(`[scores] ${romname}: ${error instanceof Error ? error.message : String(error)}`);
            return null;
        }
    }

    /** The cabinet's answer for a nameless score: the player picked, or null. Never throws. */
    public async attribute(romname: string, score: number, playerId: string | null): Promise<void> {
        try {
            this.sent(romname, await this.declarations.attribute(romname, score, playerId) ? 1 : 0);
        } catch (error) {
            this.deps.log?.(`[scores] ${romname}: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    private async queue(romname: string, rows: TableRow[]): Promise<void> {
        const context = {achievedAt: new Date().toISOString(), startupId: this.deps.startupId()};
        this.declarations.hold(romname, rows, context);
        const queued = await queueScores(this.deps.store, await this.deps.players(), rows, {romname, ...context});
        this.sent(romname, queued.length);
    }

    private sent(romname: string, count: number): void {
        if (count > 0) {
            this.deps.log?.(`[scores] ${romname}: ${count} score(s) queued for MAUI-API.`);
            this.deps.flush();
        }
    }
}
