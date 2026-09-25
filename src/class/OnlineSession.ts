import {release} from 'os';
import {toApiBaseUrl} from '@/class/ConfigurationString';
import {computeMachineFingerprint, readOsMachineId, type MachineIdSources} from '@/class/MachineFingerprint';
import {MauiApiClient, type ApiFailure, type ApiResult, type StartupReport} from '@/class/MauiApiClient';
import {
    OnlineSettingsError,
    ensureLocalUuid,
    getOnlineSettingsPath,
    readOnlineSettings,
    type OnlineSettings,
} from '@/class/OnlineSettings';

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
    settingsPath?: string;
    fetchImpl?: typeof fetch;
    machineIdSources?: MachineIdSources;
    platform?: NodeJS.Platform;
    osRelease?: () => string;
    heartbeatIntervalMs?: number;
    log?: (message: string) => void;
}

const HEARTBEAT_INTERVAL_MS = 60_000;

const idle = (state: OnlineState): OnlineStatus => ({state, startupId: null, lastSuccessAt: null, lastFailure: null});

function isConfigured(settings: OnlineSettings): boolean {
    return settings.url !== '' && settings.key !== '' && settings.token !== '';
}

export class OnlineSession {
    private status: OnlineStatus = idle('disabled');
    private timer: ReturnType<typeof setTimeout> | null = null;
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
        if (!isConfigured(settings)) {
            this.status = idle('not_configured');
            return;
        }

        this.status = idle('running');
        const client = await this.createClient(settings);
        const startup = await client.reportStartup(await this.startupReport());
        if (generation !== this.generation) {
            return;
        }
        if (startup.kind === 'ok') {
            this.status = {...this.status, startupId: startup.value.id};
        }
        this.handle(startup, client, generation);
    }

    public stop(): void {
        this.generation++;
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
        const {localUuid} = ensureLocalUuid(this.settingsPath);
        const osMachineId = await readOsMachineId(this.deps.platform, this.deps.machineIdSources);
        return new MauiApiClient({
            baseUrl: toApiBaseUrl(settings.url),
            key: settings.key,
            token: settings.token,
            fingerprint: computeMachineFingerprint(localUuid, osMachineId),
        }, {fetchImpl: this.deps.fetchImpl});
    }

    private async startupReport(): Promise<StartupReport> {
        return {
            mameVersion: await this.deps.readMameVersion(),
            mauiVersion: this.deps.mauiVersion,
            os: (this.deps.platform ?? process.platform) as StartupReport['os'],
            osVersion: (this.deps.osRelease ?? release)(),
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

    private schedule(delayMs: number, client: MauiApiClient, generation: number): void {
        const timer = setTimeout(async () => {
            const result = await client.heartbeat();
            if (generation === this.generation) {
                this.handle(result, client, generation);
            }
        }, delayMs);
        // Must not keep the process alive: onReset exits with app.exit(0), which skips will-quit.
        timer.unref?.();
        this.timer = timer;
    }
}
