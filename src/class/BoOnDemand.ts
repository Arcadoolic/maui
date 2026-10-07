import type {IncomingMessage, ServerResponse} from 'http';

// The BO loaded by the first request that reaches its port, and dropped once left idle (see
// boCore.ts for why). Knows nothing of express nor Electron: what loading means is handed in.

/** The BO once loaded: express's request handler and what dropping it needs. */
export interface BoApp {
    handler(req: IncomingMessage, res: ServerResponse): void;
    // Something of the BO's is still going on outside any request (a MAME it launched): not now.
    isBusy(): boolean;
    // Lets go of what the BO holds: its sessions (signing in again is expected), caches, timers.
    dispose(): void;
}

export interface BoOnDemandOptions {
    load: () => Promise<BoApp>;
    // How long without a request before the BO is dropped; 0 or less keeps it for good. Asked
    // again at each check: the setting is changed from the BO itself.
    idleMs: () => number;
    now?: () => number;
    log?: (message: string) => void;
}

export class BoOnDemand {
    protected readonly options: BoOnDemandOptions;
    protected app: BoApp | null = null;
    protected loading: Promise<BoApp> | null = null;
    protected inFlight = 0;
    protected lastActivity = 0;

    public constructor(options: BoOnDemandOptions) {
        this.options = options;
    }

    public isLoaded(): boolean {
        return this.app !== null;
    }

    /** Loads the BO when it is not: by its first request, or from the cabinet (Home.vue). */
    public async wake(): Promise<BoApp> {
        this.lastActivity = this.now();
        if (this.app) {
            return this.app;
        }
        // One load for the requests arriving together (a page and its images).
        this.loading ??= this.options.load().then(
            (app) => {
                this.app = app;
                this.loading = null;
                this.options.log?.('BO loaded');
                return app;
            },
            (error) => {
                this.loading = null;
                throw error;
            },
        );
        return this.loading;
    }

    public async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
        this.inFlight++;
        res.on('close', () => {
            this.inFlight--;
            // Counted from the end of the answer: a long download does not use the delay up.
            this.lastActivity = this.now();
        });
        try {
            (await this.wake()).handler(req, res);
        } catch (error) {
            this.options.log?.(`BO not loaded: ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
            res.statusCode = 503;
            res.setHeader('Content-Type', 'text/plain; charset=utf-8');
            res.end('The back office could not be started - restart the application, then retry.');
        }
    }

    /** Drops the BO when it has been idle for long enough. Returns whether it did. */
    public check(): boolean {
        const idleMs = this.options.idleMs();
        if (!this.app || idleMs <= 0 || this.inFlight > 0 || this.app.isBusy()
            || this.now() - this.lastActivity < idleMs) {
            return false;
        }
        const app = this.app;
        this.app = null;
        app.dispose();
        this.options.log?.('BO unloaded after being left idle');
        return true;
    }

    protected now(): number {
        return (this.options.now ?? Date.now)();
    }
}
