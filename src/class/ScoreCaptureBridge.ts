// The front (Home.vue) tells the main process when a game starts and ends, for ScoreCapture.ts:
// functions background.ts exposes as globals, reached through @electron/remote, as the ONLINE
// badge does (OnlineIndicatorBridge.ts).
export const PLAY_STARTED_GLOBAL = 'mauiPlayStarted';
export const PLAY_ENDED_GLOBAL = 'mauiPlayEnded';

export type PlayNotifier = (romName: string) => Promise<void>;

// Sent by the main process to the window when the shared leaderboards changed (LeaderboardSync.ts).
export const LEADERBOARDS_CHANGED_CHANNEL = 'maui:leaderboards-changed';
