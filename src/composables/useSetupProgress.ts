import {onMounted, onUnmounted, ref, type Ref} from 'vue';
import * as remote from '@electron/remote';
import type {SetupProgress} from '@/class/SetupSteps';
import {SETUP_PROGRESS_GLOBAL, type SetupProgressReader} from '@/class/SetupStepsBridge';

// Short: the steps are done from the BO, on another screen, and this one follows them.
const REFRESH_MS = 3000;

/**
 * The setup guide's steps as the main process reads them (SetupStepsBridge.ts), asked again every
 * few seconds. Null until the first reading is done, or when it cannot be had.
 */
export function useSetupProgress(): Ref<SetupProgress | null> {
    const progress = ref<SetupProgress | null>(null);
    let timer: ReturnType<typeof setInterval> | undefined;

    function refresh(): void {
        try {
            const read = remote.getGlobal(SETUP_PROGRESS_GLOBAL) as SetupProgressReader | undefined;
            progress.value = read ? read() : null;
        } catch {
            // Kept as it was.
        }
    }

    refresh();
    onMounted(() => {
        // The main process hands back its previous reading and starts the next: asked again soon
        // after the first call, the screen does not wait a whole period for it.
        setTimeout(refresh, 300);
        timer = setInterval(refresh, REFRESH_MS);
    });
    onUnmounted(() => clearInterval(timer));
    return progress;
}
