import {release} from 'os';
import type {MachineIdSources} from '@/class/MachineFingerprint';
import {MauiApiClient, type ApiFailure, type ApiResult, type StartupReport, type StartupResult} from '@/class/MauiApiClient';
import {
    OnlineSettingsError,
    getOnlineSettingsPath,
    readOnlineSettings,
    writeOnlineSettings,
    type OnlineSettings,
} from '@/class/OnlineSettings';
import type {OnlineIdentity} from '@/class/OnlineIndicatorBridge';
import {buildApiCredentials, isOnlineConfigured} from '@/class/OnlineCredentials';
import {readOsName} from '@/class/OsName';
import type {FlushSummary} from '@/class/ScoreOutbox';
import type {OpinionReportSummary} from '@/class/OpinionReport';

// ONLINE mode for one run of MAUI: a startup report, then a heartbeat at a fixed interval (no
// backoff: MAUI-API shows a cabinet offline after 3 minutes without one, see docs/DECISIONS.md).
// A definitive rejection, known code or not, stops it until restart(). Never throws and never
// blocks MAUI: every failure only ends up in getStatus(), shown by the BO.

export type OnlineState = 'disabled' | 'not_configured' | 'unreadable' | 'running' | 'stopped';

export interface OnlineStatus {
    state: OnlineState;
    // Attached to scores in Lot 2. Null when the startup report failed.
    startupId: string | null;
    lastSuccessAt: string | null;
    lastFailure: {at: string; result: ApiFailure} | null;
}

export interface OnlineSessionDeps {
    mauiVersion: string;
    readMameVersion: () => Promise<string>;
    readOsName?: () => Promise<string>;
    settingsPath?: string;
    fetchImpl?: typeof fetch;
    machineIdSources?: MachineIdSources;
    platform?: NodeJS.Platform;
    osRelease?: () => string;
    heartbeatIntervalMs?: number;
    log?: (message: string) => void;
    // Players of this cabinet (PlayerSync.ts), after the startup report and every
    // PLAYER_SYNC_EVERY heartbeats. None: no sync (tests, or a caller without database).
    syncPlayers?: (client: MauiApiClient) => Promise<ApiResult<number>>;
    // Sends the score outbox (ScoreOutbox.ts), after the startup report, after every successful
    // heartbeat and on demand (flushScoresNow()). None: no scores (tests).
    flushScores?: (client: MauiApiClient) => Promise<FlushSummary>;
    // Sends the votes and play counts MAUI-API does not have (OpinionReport.ts), after the startup
    // report and every successful heartbeat. None: no report (tests).
    reportOpinions?: (client: MauiApiClient) => Promise<OpinionReportSummary>;
    // Refreshes the cache of the shared leaderboards (LeaderboardSync.ts): after the startup report,
    // with the player sync, and after scores were accepted. None: no leaderboards (tests).
    refreshLeaderboards?: (client: MauiApiClient) => Promise<unknown>;
}

const HEARTBEAT_INTERVAL_MS = 60_000;
// Every 10 minutes with the default interval: a player disabled or locked upstream is caught soon
// enough, without a second request every minute.
const PLAYER_SYNC_EVERY = 10;

const idle = (state: OnlineState): OnlineStatus => ({state, startupId: null, lastSuccessAt: null, lastFailure: null});

export class OnlineSession {
    private status: OnlineStatus = idle('disabled');
    // The cabinet's name and the server's environment, as the settings file last had them, then
    // as the startup report answered. Null when not known.
    private identity: OnlineIdentity | null = null;
    private timer: ReturnType<typeof setTimeout> | null = null;
    private heartbeats = 0;
    // Client of the running session, for syncPlayersNow(); null when stopped.
    private client: MauiApiClient | null = null;
    // The flush in progress: a second one waits for it instead of sending the same scores again.
    private flushing: Promise<FlushSummary | null> | null = null;
    private refreshing: Promise<void> | null = null;
    private reporting: Promise<void> | null = null;
    // False until the players and the leaderboards were asked once in this run: when MAUI-API
    // is down at startup, the first heartbeat that gets through does it, without waiting for
    // the PLAYER_SYNC_EVERY cycle.
    private caughtUp = false;
    // Bumped by every start/stop: a call still in flight from an older run must not reschedule.
    private generation = 0;
    private readonly settingsPath: string;
    private readonly intervalMs: number;
    private readonly log: (message: string) => void;

    public constructor(private readonly deps: OnlineSessionDeps) {
        this.settingsPath = deps.settingsPath ?? getOnlineSettingsPath();
        this.intervalMs = deps.heartbeatIntervalMs ?? HEARTBEAT_INTERVAL_MS;
        this.log = deps.log ?? (message => console.warn(message));
    }

    public getStatus(): OnlineStatus {
        return this.status;
    }

    /** Kept while the session is stopped or turned off: the badge still names the cabinet. */
    public getIdentity(): OnlineIdentity | null {
        return this.identity;
    }

    /** The client of the running session, null when it is not running. */
    public currentClient(): MauiApiClient | null {
        return this.status.state === 'running' ? this.client : null;
    }

    public async start(): Promise<void> {
        this.stop();
        const generation = this.generation;
        try {
            await this.run(generation);
        } catch (error) {
            if (generation === this.generation) {
                this.status = idle('stopped');
            }
            this.log(`[online] ONLINE could not start: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    private async run(generation: number): Promise<void> {
        let settings: OnlineSettings;
        try {
            settings = readOnlineSettings(this.settingsPath);
        } catch (error) {
            if (!(error instanceof OnlineSettingsError)) {
                throw error;
            }
            this.status = idle('unreadable');
            this.identity = null;
            return;
        }
        this.identity = settings.cabinetName
            ? {cabinetName: settings.cabinetName, environment: settings.environment ?? null}
            : null;
        if (!settings.enabled) {
            this.status = idle('disabled');
            return;
        }
        if (!isOnlineConfigured(settings)) {
            this.status = idle('not_configured');
            return;
        }

        this.status = idle('running');
        const client = await this.createClient(settings);
        this.client = client;
        const startup = await client.reportStartup(await this.startupReport());
        if (generation !== this.generation) {
            return;
        }
        if (startup.kind === 'ok') {
            this.status = {...this.status, startupId: startup.value.id};
            this.identify(startup.value);
            this.heartbeats = 0;
            this.caughtUp = true;
            void this.syncPlayers(client);
            void this.flushScores(client).then(() => this.refreshLeaderboards(client));
            void this.reportOpinions(client);
        }
        this.handle(startup, client, generation);
    }

    /** Keeps what the server said of the cabinet, in the settings file too. Never throws. */
    private identify({cabinetName, environment}: StartupResult): void {
        if (cabinetName === null
            || (cabinetName === this.identity?.cabinetName && environment === this.identity.environment)) {
            return;
        }
        this.identity = {cabinetName, environment};
        try {
            // Read again: the BO may have written the file since the session started.
            const settings = readOnlineSettings(this.settingsPath);
            writeOnlineSettings({...settings, cabinetName, environment: environment ?? undefined}, this.settingsPath);
        } catch (error) {
            this.log(`[online] Cabinet name not saved: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    public stop(): void {
        this.generation++;
        this.client = null;
        this.caughtUp = false;
        if (this.timer) {
            clearTimeout(this.timer);
            this.timer = null;
        }
        this.status = idle('disabled');
    }

    public restart(): Promise<void> {
        return this.start();
    }

    private async createClient(settings: OnlineSettings): Promise<MauiApiClient> {
        return new MauiApiClient(
            await buildApiCredentials(settings, this.settingsPath, this.deps), {fetchImpl: this.deps.fetchImpl},
        );
    }

    private async startupReport(): Promise<StartupReport> {
        return {
            mameVersion: await this.deps.readMameVersion(),
            mauiVersion: this.deps.mauiVersion,
            os: (this.deps.platform ?? process.platform) as StartupReport['os'],
            osVersion: (this.deps.osRelease ?? release)(),
            osName: await (this.deps.readOsName ?? (() => readOsName(this.deps.platform)))(),
            clientDatetime: new Date().toISOString(),
        };
    }

    private handle(result: ApiResult<unknown>, client: MauiApiClient, generation: number): void {
        const at = new Date().toISOString();
        if (result.kind === 'ok') {
            this.status = {...this.status, lastSuccessAt: at};
            this.schedule(this.intervalMs, client, generation);
            return;
        }
        this.status = {...this.status, lastFailure: {at, result}};
        if (result.kind === 'rejected') {
            this.status = {...this.status, state: 'stopped'};
            this.log(`[online] MAUI-API rejected the cabinet (HTTP ${result.status}, ${result.code}): ONLINE stopped.`);
            return;
        }
        const delay = result.kind === 'rate_limited'
            ? Math.max(result.retryAfterSeconds * 1000, this.intervalMs)
            : this.intervalMs;
        this.schedule(delay, client, generation);
    }

    /**
     * An extra sync, awaited, for the BO's Players tab: an admin's change in MAUI-API shows at once
     * instead of at the next PLAYER_SYNC_EVERY heartbeats. 'skipped' while the session is not
     * running. Never throws.
     */
    public async syncPlayersNow(): Promise<'ok' | 'failed' | 'skipped'> {
        if (!this.client || this.status.state !== 'running') {
            return 'skipped';
        }
        return await this.syncPlayers(this.client) ? 'ok' : 'failed';
    }

    /**
     * Sends the score outbox now, e.g. right after a game found a score. Null while the session
     * is not running (the scores wait for it). Never throws.
     */
    public flushScoresNow(): Promise<FlushSummary | null> {
        return this.client && this.status.state === 'running' ? this.flushScores(this.client) : Promise.resolve(null);
    }

    /** One refresh at a time. Never throws: the cache keeps what it had. */
    private refreshLeaderboards(client: MauiApiClient): Promise<void> {
        if (!this.deps.refreshLeaderboards) {
            return Promise.resolve();
        }
        if (this.refreshing) {
            return this.refreshing;
        }
        const refresh = this.deps.refreshLeaderboards;
        this.refreshing = refresh(client)
            .then(() => undefined)
            .catch((error: unknown) => {
                this.log(`[online] Leaderboards not refreshed: ${error instanceof Error ? error.message : String(error)}`);
            })
            .finally(() => {
                this.refreshing = null;
            });
        return this.refreshing;
    }

    /** One report at a time. Never throws: a failure is logged, the games stay due. */
    private reportOpinions(client: MauiApiClient): Promise<void> {
        if (!this.deps.reportOpinions) {
            return Promise.resolve();
        }
        if (this.reporting) {
            return this.reporting;
        }
        const report = this.deps.reportOpinions;
        this.reporting = report(client)
            .then(summary => {
                if (summary.failure) {
                    this.log(`[online] Votes and plays not sent (${summary.failure.kind}): kept for the next try.`);
                }
            })
            .catch((error: unknown) => {
                this.log(`[online] Votes and plays not sent: ${error instanceof Error ? error.message : String(error)}`);
            })
            .finally(() => {
                this.reporting = null;
            });
        return this.reporting;
    }

    /** One flush at a time. Never throws: a failure is logged, the outbox keeps the scores. */
    private flushScores(client: MauiApiClient): Promise<FlushSummary | null> {
        if (!this.deps.flushScores) {
            return Promise.resolve(null);
        }
        if (this.flushing) {
            return this.flushing;
        }
        const flush = this.deps.flushScores;
        this.flushing = flush(client)
            .then(summary => {
                if (summary.failure) {
                    this.log(`[online] Scores not sent (${summary.failure.kind}): kept for the next try.`);
                }
                if (summary.accepted > 0) {
                    // New bests: the leaderboards changed.
                    void this.refreshLeaderboards(client);
                }
                return summary;
            })
            .catch((error: unknown) => {
                this.log(`[online] Scores not sent: ${error instanceof Error ? error.message : String(error)}`);
                return null;
            })
            .finally(() => {
                this.flushing = null;
            });
        return this.flushing;
    }

    /** Never throws: a failed sync is logged and retried at the next turn. Resolves to its success. */
    private syncPlayers(client: MauiApiClient): Promise<boolean> {
        if (!this.deps.syncPlayers) {
            return Promise.resolve(false);
        }
        return this.deps.syncPlayers(client).then(
            result => {
                if (result.kind !== 'ok') {
                    const reason = result.kind === 'rejected' ? `HTTP ${result.status}, ${result.code}` : result.kind;
                    this.log(`[online] Player sync failed (${reason}).`);
                }
                return result.kind === 'ok';
            },
            (error: unknown) => {
                this.log(`[online] Player sync failed: ${error instanceof Error ? error.message : String(error)}`);
                return false;
            },
        );
    }

    private schedule(delayMs: number, client: MauiApiClient, generation: number): void {
        const timer = setTimeout(async () => {
            const result = await client.heartbeat();
            if (generation === this.generation) {
                if (result.kind === 'ok' && (++this.heartbeats % PLAYER_SYNC_EVERY === 0 || !this.caughtUp)) {
                    this.caughtUp = true;
                    void this.syncPlayers(client);
                    void this.refreshLeaderboards(client);
                }
                if (result.kind === 'ok') {
                    void this.flushScores(client);
                    void this.reportOpinions(client);
                }
                this.handle(result, client, generation);
            }
        }, delayMs);
        // Must not keep the process alive: onReset exits with app.exit(0), which skips will-quit.
        timer.unref?.();
        this.timer = timer;
    }
}
