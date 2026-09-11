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
});

app.on('window-all-closed', () => {
    app.quit();
});
