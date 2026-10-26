// The front's update of MAUI (FrontUpdate.ts in the main process, Home.vue): the front reads the
// offer and answers it through @electron/remote under this global name, and follows the
// installation on this channel, one message per step.
export const FRONT_UPDATE_GLOBAL = 'mauiFrontUpdate';
export const UPDATE_PROGRESS_CHANNEL = 'maui:update-progress';
// A check found a version to offer that the front was not told of yet (the first one after the
// start, mostly): the front offers it at once instead of waiting for it to wake from idle.
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

export interface FrontUpdateControl {
    /** The version to offer (when the front wakes up from idle, or at once when told); null when there is none. */
    offer(): string | null;
    /** No: this version is not offered again on the front (the next one will be). */
    decline(version: string): void;
    /** Yes: whether the installation of this version started (only the version offered does). */
    install(version: string): boolean;
}
