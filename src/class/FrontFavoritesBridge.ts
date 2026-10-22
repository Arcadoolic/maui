// The BO took a game out of the favorites (Favorites tab's remove button, a thumbs down from its
// Votes column) or put one back: the main process tells the window, where Home.vue syncs its games
// with favorites.ini and builds its carousel again, so a removed game is gone at once instead of
// at MAUI's next start.
export const FAVORITES_CHANGED_CHANNEL = 'maui:favorites-changed';

/** Tells the front, when its window is open. */
export type FrontFavoritesNotifier = () => void;
