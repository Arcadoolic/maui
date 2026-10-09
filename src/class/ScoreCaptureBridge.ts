// The front (Home.vue) tells the main process when a game starts and ends, for ScoreCapture.ts:
// functions background.ts exposes as globals, reached through @electron/remote, as the ONLINE
// badge does (OnlineIndicatorBridge.ts).
export const PLAY_STARTED_GLOBAL = 'mauiPlayStarted';
export const PLAY_ENDED_GLOBAL = 'mauiPlayEnded';

export type PlayNotifier = (romName: string) => Promise<void>;

// Scores the game wrote without a name, when several players of the cabinet could have made them
// (ScoreDeclaration.ts): asked one by one, best first (WhoPlayedModal.vue).
export interface PendingAttribution {
    romname: string;
    scores: {score: number; rank: number}[];
    players: {remoteId: string; pseudo3: string}[];
}

/**
 * Resolves to a PendingAttribution as JSON, or null when there is nothing to ask. A string, since
 * @electron/remote hands objects over as proxies that reach back to the main process for each
 * property. Never rejects.
 */
export type PlayEndNotifier = (romName: string) => Promise<string | null>;

// The front's answer for one of those scores: the player picked, or null when nobody claimed it.
export const SCORE_ATTRIBUTE_GLOBAL = 'mauiAttributeScore';

/** Never rejects. */
export type ScoreAttributor = (romName: string, score: number, playerId: string | null) => Promise<void>;

// Sent by the main process to the window when the shared leaderboards changed (LeaderboardSync.ts).
export const LEADERBOARDS_CHANGED_CHANNEL = 'maui:leaderboards-changed';
