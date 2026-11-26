// The front's update of MAUI (FrontUpdate.ts in the main process, Home.vue): the front reads the
// offer and answers it through @electron/remote under this global name, and follows the
// installation on this channel, one message per step.
export const FRONT_UPDATE_GLOBAL = 'mauiFrontUpdate';
export const UPDATE_PROGRESS_CHANNEL = 'maui:update-progress';
// The first check after the start found a version to offer: the front takes the offer
// (takeStartOffer()), which it also does when it is loaded after that check.
export const UPDATE_AVAILABLE_CHANNEL = 'maui:update-available';

export type UpdateStep =
    | {step: 'download'; doneBytes: number; totalBytes: number}
    // entries: extracted so far; totalEntries: those of the version installed, an estimate (0: unknown).
    | {step: 'extract'; entries: number; totalEntries: number}
    | {step: 'switch'}
    // The previous version's backup being deleted, the new one kept as ~/squashfs-root.old.
    | {step: 'cleanup'}
    // The last message when it works: the application goes down and comes back on the new version.
    | {step: 'restart'}
    // The last message when it does not: the installed version is left as it was.
    | {step: 'failed'; message: string};

export type UpdateCheck =
    // 'bo-only': the BO switched the front's offer off. 'manual': this machine cannot install by
    // itself, from the front nor from the BO.
    | {status: 'offer' | 'bo-only' | 'manual'; version: string}
    | {status: 'up-to-date' | 'unreachable'};

export interface FrontUpdateControl {
    /** The version to offer at the start of MAUI, once; null when there is none. */
    takeStartOffer(): string | null;
    /** The version the front may install, declined or not; null when there is none. */
    installable(): string | null;
    /** Looks for a newer version now (the system menu). */
    check(): Promise<UpdateCheck>;
    /** No: this version is not offered again at a start (the next one will be). */
    decline(version: string): void;
    /** Yes: whether the installation of this version started (only the installable one does). */
    install(version: string): boolean;
}
