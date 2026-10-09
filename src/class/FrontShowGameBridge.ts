// The BO's Favorites tab can put the front on a game (boServer.ts, POST /favorites/show): the main
// process passes the rom name on to the window, where Home.vue moves its carousel to the game.
export const SHOW_GAME_CHANNEL = 'maui:show-game';

/** Whether there was a window to tell. The front ignores it while a game or a question is up. */
export type FrontGameShower = (romName: string) => boolean;
