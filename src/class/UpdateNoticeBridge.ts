// A newer release of MAUI, as the main process knows it (UpdateWatch.ts in boCore.ts): the front
// reads it through @electron/remote under this global name when it turns idle (Home.vue), like the
// ONLINE badge (OnlineIndicatorBridge.ts).
export const UPDATE_NOTICE_GLOBAL = 'mauiAvailableUpdate';

export type UpdateNoticeReader = () => string | null;
