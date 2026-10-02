import {release} from 'os';
import type {MachineIdSources} from '@/class/MachineFingerprint';
import {MauiApiClient, type ApiFailure, type ApiResult, type StartupReport} from '@/class/MauiApiClient';
import {
    OnlineSettingsError,
    getOnlineSettingsPath,
    readOnlineSettings,
    type OnlineSettings,
} from '@/class/OnlineSettings';
import {buildApiCredentials, isOnlineConfigured} from '@/class/OnlineCredentials';
import {readOsName} from '@/class/OsName';

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
}

const HEARTBEAT_INTERVAL_MS = 60_000;
// Every 10 minutes with the default interval: a player disabled or locked upstream is caught soon
// enough, without a second request every minute.
const PLAYER_SYNC_EVERY = 10;

const idle = (state: OnlineState): OnlineStatus => ({state, startupId: null, lastSuccessAt: null, lastFailure: null});

export class OnlineSession {
    private status: OnlineStatus = idle('disabled');
    private timer: ReturnType<typeof setTimeout> | null = null;
    private heartbeats = 0;
    // Client of the running session, for syncPlayersNow(); null when stopped.
    private client: MauiApiClient | null = null;
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
            return;
        }
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
            this.heartbeats = 0;
            void this.syncPlayers(client);
        }
        this.handle(startup, client, generation);
    }

    public stop(): void {
        this.generation++;
        this.client = null;
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
                if (result.kind === 'ok' && ++this.heartbeats % PLAYER_SYNC_EVERY === 0) {
                    void this.syncPlayers(client);
                }
                this.handle(result, client, generation);
            }
        }, delayMs);
        // Must not keep the process alive: onReset exits with app.exit(0), which skips will-quit.
        timer.unref?.();
        this.timer = timer;
    }
}
