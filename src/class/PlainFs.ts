import * as nodeFs from 'fs';

/**
 * Node's fs without Electron's .asar support. In Electron's main process, fs reads an app.asar
 * file as a directory: a recursive readdir() counts the thousands of files packed in it, and a
 * recursive rm() goes into it, then fails to remove the "directory" with ENOTEMPTY. For whole
 * MAUI installations (~/squashfs-root, the update's work directory), use this one.
 *
 * original-fs only exists in Electron: elsewhere (unit tests), fs has no .asar support anyway.
 */
// eslint-disable-next-line @typescript-eslint/no-require-imports
export const plainFs: typeof nodeFs = process.versions.electron ? require('original-fs') : nodeFs;
