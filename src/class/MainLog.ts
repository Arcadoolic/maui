import {app} from 'electron';
import log from 'electron-log/main';
import {dirname, join} from 'path';
import {adoptLegacyLogs, archive, LOG_FILE_NAME, tidyArchives} from '@/class/LogArchive';

/**
 * MAUI's log file, written by both processes: the main process's console (score capture, score
 * outbox, ONLINE session, BO) and the renderer's electron-log calls, sent over IPC. On a cabinet
 * the console goes nowhere (the kiosk session runs the AppImage without redirecting it), so the
 * file is the only trace. Past 1 MB it is archived and compressed (LogArchive.ts).
 *
 * In the user's log directory: ~/.config/mame-awesome-ui/logs on Linux,
 * %APPDATA%\mame-awesome-ui\logs on Windows, ~/Library/Logs/mame-awesome-ui on macOS.
 *
 * Called once, first thing in the main process.
 */
export function setUpMainLog(): void {
    // The renderer loads electron-log's preload itself (kept on runtime require(), see
    // electron.vite.config.ts): injecting it into the session too would register it twice.
    log.initialize({preload: false});
    log.transports.file.fileName = LOG_FILE_NAME;
    log.transports.file.maxSize = 1024 * 1024;
    log.transports.file.archiveLogFn = (file) => {
        try {
            archive(file.path);
        } catch {
            // Not renamed (a file another process holds open on Windows): start it again rather
            // than let it grow.
            file.clear();
        }
    };
    Object.assign(console, log.functions);

    const dir = dirname(log.transports.file.getFile().path);
    adoptLegacyLogs([
        join(app.getPath('userData'), 'log.log'),
        join(app.getPath('userData'), 'log.old.log'),
        join(dir, 'log.log'),
        join(dir, 'log.old.log'),
    ], dir);
    void tidyArchives(dir);
}
