import {ref} from 'vue';
import {ipcRenderer} from 'electron';
import {MEDIA_CHANGED_CHANNEL} from '@/class/FrontMediaBridge';

// The games whose pictures MediaSync.ts replaced during this run, each with how many times: their
// file: URLs get `?v=<n>`, else Chromium shows the picture it already decoded for the same URL.
const versions = new Map<string, number>();
// Bumped on every change: what reads the lists of pictures reads them again (watch it).
const revision = ref(0);
let listening = false;

function listen(): void {
    if (listening) {
        return;
    }
    listening = true;
    ipcRenderer.on(MEDIA_CHANGED_CHANNEL, (_event: unknown, romnames: unknown) => {
        if (!Array.isArray(romnames)) {
            return;
        }
        for (const romname of romnames) {
            if (typeof romname === 'string') {
                versions.set(romname, (versions.get(romname) ?? 0) + 1);
            }
        }
        revision.value++;
    });
}

/** One listener for the whole window, set up by the first component that asks. */
export function useMediaChanges() {
    listen();
    return {
        revision,
        versioned: (url: string, romname: string): string => {
            const version = versions.get(romname);
            return version && url.startsWith('file:') ? `${url}?v=${version}` : url;
        },
    };
}
