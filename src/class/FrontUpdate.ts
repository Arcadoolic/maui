import {existsSync, mkdirSync, readFileSync, writeFileSync} from 'fs';
import {homedir} from 'os';
import {dirname, join} from 'path';
import type {UpdateChannel} from '@/class/ReleaseList';
import type {FrontUpdateControl, UpdateCheck, UpdateStep} from '@/class/FrontUpdateBridge';
import type {UpdateProgress} from '@/class/SelfUpdate';

// The update of MAUI asked on the front (Home.vue): once at the start of MAUI, and when the system
// menu looks for one, the player is asked about a newer version on the BO's channel; a thumbs up
// installs it and restarts MAUI on it, the front showing each step. Only that version can be
// installed: the front never picks a version nor a file, and never goes back to an earlier one. A
// thumbs down is remembered, so that this version is not asked again at a start (the menu still
// asks); the next one will be.

/** What FrontUpdate needs of the rest of the main process (background.ts), replaceable in tests. */
export interface FrontUpdateDeps {
    /** Where the declined version is kept (getDeclinedUpdatePath() by default). */
    declinedPath?: string;
    /** The BO's settings, read again at each call. */
    settings(): {frontUpdateEnabled: boolean; updateChannel: UpdateChannel};
    /** Whether this machine installs a version by itself (SelfUpdate.ts isSelfUpdateCapable()). */
    capable(): boolean;
    /** The newer version on a channel (UpdateWatch.ts available()). */
    available(channel: UpdateChannel): string | null;
    /** Asks for the list of versions again; false when it could not be read. */
    refresh(): Promise<boolean>;
    /** Installs `version` and restarts on it; throws, the installed version left as it was, when it cannot. */
    installAndRestart(version: string, progress: UpdateProgress): Promise<void>;
    /** Where each step goes: the front's window. */
    send(step: UpdateStep): void;
}

export function getDeclinedUpdatePath(): string {
    return join(homedir(), '.mame-awesome-ui', 'declined-update.json');
}

export class FrontUpdate implements FrontUpdateControl {
    private installing = false;
    private startOffer: 'pending' | 'ready' | 'taken' = 'pending';

    public constructor(private readonly deps: FrontUpdateDeps) {}

    /** The version to ask about unprompted: not one already declined. */
    public offer(): string | null {
        const version = this.installable();
        return version !== null && version !== this.readDeclined() ? version : null;
    }

    /** The version the front may install, declined or not. */
    public installable(): string | null {
        const settings = this.deps.settings();
        if (this.installing || !settings.frontUpdateEnabled || !this.deps.capable()) {
            return null;
        }
        return this.deps.available(settings.updateChannel);
    }

    /** The first check of the run is over (UpdateWatch.ts onStartCheck()). */
    public startCheckDone(): void {
        if (this.startOffer === 'pending') {
            this.startOffer = 'ready';
        }
    }

    /** The offer of the start, given once a run: null before the first check and after. */
    public takeStartOffer(): string | null {
        if (this.startOffer !== 'ready') {
            return null;
        }
        this.startOffer = 'taken';
        return this.offer();
    }

    /** The system menu's "Check for MAUI update". */
    public async check(): Promise<UpdateCheck> {
        if (!await this.deps.refresh()) {
            return {status: 'unreachable'};
        }
        const version = this.deps.available(this.deps.settings().updateChannel);
        if (version === null) {
            return {status: 'up-to-date'};
        }
        if (!this.deps.capable()) {
            return {status: 'manual', version};
        }
        return {status: this.installable() === version ? 'offer' : 'bo-only', version};
    }

    public decline(version: string): void {
        const path = this.deps.declinedPath ?? getDeclinedUpdatePath();
        try {
            mkdirSync(dirname(path), {recursive: true});
            writeFileSync(path, JSON.stringify({version}));
        } catch (error) {
            // Asked again at the next start: nothing worse.
            console.warn('[FrontUpdate] Declined version not saved:', error);
        }
    }

    public install(version: string): boolean {
        if (version !== this.installable()) {
            return false;
        }
        this.installing = true;
        void this.run(version);
        return true;
    }

    private async run(version: string): Promise<void> {
        try {
            await this.deps.installAndRestart(version, step => this.deps.send(step));
            this.deps.send({step: 'restart'});
        } catch (error) {
            this.installing = false;
            this.deps.send({step: 'failed', message: error instanceof Error ? error.message : 'Unexpected error.'});
        }
    }

    private readDeclined(): string | null {
        const path = this.deps.declinedPath ?? getDeclinedUpdatePath();
        try {
            if (!existsSync(path)) {
                return null;
            }
            const data = JSON.parse(readFileSync(path, 'utf8')) as {version?: unknown};
            return typeof data.version === 'string' ? data.version : null;
        } catch {
            return null;
        }
    }
}

/**
 * Development (MAUI_FAKE_UPDATE): the steps of an installation over a few seconds, nothing
 * downloaded nor installed - to work on the front's screens without a cabinet.
 */
export async function simulateInstall(progress: UpdateProgress, wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))): Promise<void> {
    const totalBytes = 120 * 1024 * 1024;
    for (let doneBytes = 0; doneBytes <= totalBytes; doneBytes += 6 * 1024 * 1024) {
        progress({step: 'download', doneBytes, totalBytes});
        await wait(250);
    }
    const totalEntries = 3000;
    for (let entries = 0; entries <= totalEntries; entries += 300) {
        progress({step: 'extract', entries, totalEntries});
        await wait(150);
    }
    progress({step: 'switch'});
    await wait(800);
    progress({step: 'cleanup'});
    await wait(800);
}
