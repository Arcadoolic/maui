import {existsSync, readFileSync, writeFileSync} from 'fs';
import {join} from 'path';
import * as os from 'os';

/**
 * For each player created on this cabinet, the hash of the avatar this cabinet and MAUI-API last
 * had in common. An administrator may change an avatar too (maui-api D83): with that hash, a
 * picture that differs on the two sides tells which one changed - the cabinet's, to send, or
 * MAUI-API's, to take (PlayerSync.ts). Without it the cabinet would take the administrator's
 * picture again each time its own is changed.
 */
export interface AvatarLedger {
    get(playerId: string): string | null;
    set(playerId: string, hash: string): void;
}

/** Same fixed <home>/.mame-awesome-ui as the database (Database.class.ts). */
export function getAvatarLedgerPath(): string {
    return join(os.homedir(), '.mame-awesome-ui', 'avatar-sync.json');
}

/** The ledger as a small JSON file, read at each use: the main process is its only writer. */
export class AvatarLedgerFile implements AvatarLedger {
    public constructor(private readonly path: string = getAvatarLedgerPath()) {}

    public get(playerId: string): string | null {
        const hash = this.read()[playerId];
        return typeof hash === 'string' ? hash : null;
    }

    public set(playerId: string, hash: string): void {
        const entries = this.read();
        if (entries[playerId] !== hash) {
            writeFileSync(this.path, JSON.stringify({...entries, [playerId]: hash}));
        }
    }

    /** A missing or damaged file is an empty ledger: the next synchronisation fills it again. */
    private read(): Record<string, unknown> {
        try {
            const entries = existsSync(this.path) ? JSON.parse(readFileSync(this.path, 'utf8')) : {};
            return entries && typeof entries === 'object' && !Array.isArray(entries) ? entries : {};
        } catch {
            return {};
        }
    }
}
