import {onMounted, onUnmounted, ref, type Ref} from 'vue';
import * as remote from '@electron/remote';
import {BO_SERVER_PORT} from '@/boServerPort';
import {BO_URL_GLOBAL, type BoUrlReader} from '@/class/BoWakeBridge';

const REFRESH_MS = 5000;

/**
 * The BO's address as the main process knows it (BoUrl.ts): this machine's own on a dedicated
 * cabinet. Read again every few seconds: a cabinet often shows its first screen before its network
 * is up.
 */
export function useBoUrl(): Ref<string> {
    const url = ref(`http://localhost:${BO_SERVER_PORT}`);
    let timer: ReturnType<typeof setInterval> | undefined;

    function refresh(): void {
        try {
            const read = remote.getGlobal(BO_URL_GLOBAL) as BoUrlReader | undefined;
            if (read) {
                url.value = read();
            }
        } catch {
            // Kept as it was.
        }
    }

    refresh();
    onMounted(() => {
        timer = setInterval(refresh, REFRESH_MS);
    });
    onUnmounted(() => clearInterval(timer));
    return url;
}
