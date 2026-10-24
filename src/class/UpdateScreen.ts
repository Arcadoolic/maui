import type {UpdateStep} from '@/class/FrontUpdateBridge';

// What the front's update screen (UpdateProgress.vue) shows for each step of the installation
// (FrontUpdate.ts): a label in the arcade's capitals, a percentage for its bar and a detail line.
// The download is most of the wait: it fills the bar up to DOWNLOAD_SHARE, the installation the rest.

export interface UpdateScreen {
    label: string;
    // 0 to 100; null when the size of the download is unknown (no Content-Length).
    percent: number | null;
    detail: string;
    failed: boolean;
}

const DOWNLOAD_SHARE = 80;
const EXTRACT_PERCENT = 85;
const SWITCH_PERCENT = 95;

function megabytes(bytes: number): string {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function describeUpdateStep(step: UpdateStep): UpdateScreen {
    switch (step.step) {
    case 'download': {
        const percent = step.totalBytes > 0
            ? Math.min(DOWNLOAD_SHARE, Math.floor(step.doneBytes / step.totalBytes * DOWNLOAD_SHARE))
            : null;
        const detail = step.totalBytes > 0
            ? `${megabytes(step.doneBytes)} / ${megabytes(step.totalBytes)}`
            : megabytes(step.doneBytes);
        return {label: 'DOWNLOADING', percent, detail, failed: false};
    }
    case 'extract':
        return {label: 'INSTALLING', percent: EXTRACT_PERCENT, detail: 'Unpacking the new version', failed: false};
    case 'switch':
        return {label: 'INSTALLING', percent: SWITCH_PERCENT, detail: 'Switching to the new version', failed: false};
    case 'restart':
        return {label: 'RESTARTING', percent: 100, detail: 'See you in a moment', failed: false};
    case 'failed':
        return {label: 'UPDATE FAILED', percent: null, detail: step.message, failed: true};
    }
}

/** How many of the bar's `cells` a percentage fills. */
export function filledCells(percent: number | null, cells: number): number {
    if (percent === null) {
        return 0;
    }
    return Math.max(0, Math.min(cells, Math.floor(percent / 100 * cells)));
}
