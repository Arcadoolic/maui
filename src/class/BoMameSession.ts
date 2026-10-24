import {ipcRenderer} from 'electron';
import {MAME_SESSION_CHANNEL} from './FrontControlsBridge';

// Whether the BO's own MAME runs (its config session: "Launch MAME", "Apply controls"...), a game
// on screen the front did not launch. Kept here rather than in Home.vue so that it outlives a
// reload of the list of games.

let running = false;
const listeners = new Set<() => void>();

ipcRenderer.on(MAME_SESSION_CHANNEL, (_event, value: boolean) => {
    running = value === true;
    listeners.forEach(listener => listener());
});

export function isBoMameRunning(): boolean {
    return running;
}

/** Calls `listener` each time the BO's MAME starts or stops. Returns what stops listening. */
export function onBoMameChanged(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
}
