// The front (Home.vue) can load the BO from the cabinet's own controls and show where to reach
// it: a function background.ts exposes as a global, reached through @electron/remote, as the play
// notifications are (ScoreCaptureBridge.ts).
export const BO_WAKE_GLOBAL = 'mauiWakeBackOffice';

/** Resolves to the BO's URL on the local network once it is loaded. Never rejects. */
export type BoWaker = () => Promise<string>;
