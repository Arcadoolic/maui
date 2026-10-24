// The front's update of MAUI (FrontUpdate.ts in the main process, Home.vue): the front reads the
// offer and answers it through @electron/remote under this global name, and follows the
// installation on this channel, one message per step.
export const FRONT_UPDATE_GLOBAL = 'mauiFrontUpdate';
export const UPDATE_PROGRESS_CHANNEL = 'maui:update-progress';

export type UpdateStep =
    | {step: 'download'; doneBytes: number; totalBytes: number}
    | {step: 'extract'}
    | {step: 'switch'}
    // The last message when it works: the application goes down and comes back on the new version.
    | {step: 'restart'}
    // The last message when it does not: the installed version is left as it was.
    | {step: 'failed'; message: string};

export interface FrontUpdateControl {
    /** The version to offer when the front wakes up from idle; null when there is none to offer. */
    offer(): string | null;
    /** No: this version is not offered again on the front (the next one will be). */
    decline(version: string): void;
    /** Yes: whether the installation of this version started (only the version offered does). */
    install(version: string): boolean;
}
