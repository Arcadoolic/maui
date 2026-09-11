import {app, BrowserWindow} from 'electron';
import {enable, initialize} from '@electron/remote/main';
import {join} from 'path';

// Throwaway entry for the Phase B plumbing proof. It mirrors the window options
// of src/background.ts so the probe exercises the same integration surface:
// nodeIntegration on, contextIsolation off, @electron/remote enabled.

function createWindow(): void {
    const win = new BrowserWindow({
        width: 900,
        height: 700,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false,
            sandbox: false,
        },
    });

    enable(win.webContents);

    // The probe's result lives in the DOM, which is useless when the run is
    // driven from a terminal. Forward the renderer console to stdout so the
    // checks leave a readable trace next to the Vite output.
    win.webContents.on('console-message', event => {
        process.stdout.write(`[renderer] ${event.message}\n`);

        // The renderer logs this sentinel once every check has settled. Exiting
        // here, immediately after the line was written, lets a headless run
        // terminate on its own with a status that reflects the checks, instead
        // of hanging until an external timeout kills it. Doing it from this
        // handler rather than from the renderer means no forwarded output can
        // be lost to a race with app.exit().
        const done = /^\[probe] done exit=([01])$/.exec(event.message);
        if (done) {
            app.exit(Number(done[1]));
        }
    });

    win.webContents.on('did-finish-load', () => {
        process.stdout.write('[probe] renderer finished loading\n');
    });

    if (process.env.ELECTRON_RENDERER_URL) {
        win.loadURL(process.env.ELECTRON_RENDERER_URL);
    } else {
        win.loadFile(join(__dirname, '../renderer/index.html'));
    }
}

initialize();

app.whenReady().then(() => {
    createWindow();
}).catch((error: unknown) => {
    // Without this the promise floats. The checks Tasks 7 to 9 add can throw,
    // and an unhandled rejection here would present as a probe run with no
    // window and no message at all. Exit non-zero so a headless run fails
    // loudly rather than hanging on an empty desktop.
    process.stderr.write(`[probe] startup failed: ${String(error)}\n`);
    app.exit(1);
});

app.on('window-all-closed', () => {
    app.quit();
});
