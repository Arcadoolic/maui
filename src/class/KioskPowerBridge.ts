// The front's "shut the cabinet down" hotkey (Hotkeys.ts, Home.vue): a function background.ts
// exposes as a global, reached through @electron/remote, as the BO's wake-up is (BoWakeBridge.ts).
export const SHUTDOWN_GLOBAL = 'mauiShutdown';

/** Resolves to null once the machine is going down, else to why it is not. Never rejects. */
export type ShutdownRequest = () => Promise<string | null>;
