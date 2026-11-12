// The BO's URL, without loading it: what the first-run screen and the empty game list show, read
// by the front through a function background.ts exposes as a global (@electron/remote), as the
// play notifications are (ScoreCaptureBridge.ts).
export const BO_URL_GLOBAL = 'mauiBackOfficeUrl';

export type BoUrlReader = () => string;
