// The pictures of some games changed on the disk (MediaSync.ts, maui-api D99): the main process
// sends their romnames to the window, whose lists of marquees, flyers and logos are read again
// (useMediaChanges.ts) and whose images of those games are loaded again past Chromium's cache.
export const MEDIA_CHANGED_CHANNEL = 'maui:media-changed';
