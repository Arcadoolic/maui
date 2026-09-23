'use strict';

import {app, BrowserWindow} from 'electron';
import * as remoteMain from '@electron/remote/main';
import BrowserWindowConstructorOptions = Electron.BrowserWindowConstructorOptions;
import {join} from 'path';
import {Server} from 'http';
import {startBoServer} from '@/boServer';
import {BO_SERVER_PORT} from '@/boServerPort';
import Config from '@/class/Config.class';
import {exitWhenParentGone} from '@/devParentWatch';

remoteMain.initialize();

const isDevelopment = process.env.NODE_ENV !== 'production';

// Keep a global reference of the window object, if you don't, the window will
// be closed automatically when the JavaScript object is garbage collected.
let win: BrowserWindow | null;
let boServer: Server | undefined;

function loadPath(winVar: BrowserWindow, path: string) {
    if (process.env.ELECTRON_RENDERER_URL) {
        // Load the url of the dev server if in development mode
        winVar.loadURL(process.env.ELECTRON_RENDERER_URL + '#/' + path);
        if (!process.env.IS_TEST) {
            const config = new Config();
            config.load();
            if (config.openDevTools) {
                winVar.webContents.openDevTools();
            }
        }
    } else {
        winVar.loadFile(join(__dirname, '../renderer/index.html'), {hash: '/' + path});
    }
}

function createWindow(options: BrowserWindowConstructorOptions, path: string): BrowserWindow {
    // Create the browser window.
    let winVar: BrowserWindow | null = new BrowserWindow(options);
    remoteMain.enable(winVar.webContents);

    loadPath(winVar, path);

    winVar.on('closed', () => {
        winVar = null;
    });
    return winVar;
}

// Quit when all windows are closed.
app.on('window-all-closed', () => {
    // On macOS it is common for applications and their menu bar
    // to stay active until the user quits explicitly with Cmd + Q
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('activate', () => {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    // if (win === null) {
    //     win = createMainWin();
    // }
});

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.on('ready', async () => {
    const bo = startBoServer(BO_SERVER_PORT, () => {
        if (win) {
            loadPath(win, 'init');
        }
    }, () => {
        // Unlike reloadFront() above (a route reload is enough after a config save or a pack
        // import), a reset needs a real process restart: services.ts only ever builds its
        // MameService/GameService/... once (see services.ts's initServices()), so those would
        // keep serving stale data - parsed from the mame home files /reset just deleted - even
        // after reloading to /init and going through first-run setup again.
        //
        // app.relaunch() is NOT used here: under `electron-vite dev` the app is a child process
        // orchestrated by electron-vite's dev server, and relaunch()'s re-spawn doesn't reconnect
        // to that setup - the process just exits and nothing comes back. So the /reset response
        // tells the user to close and restart manually (`just serve` in dev; relaunching the
        // packaged app otherwise), and this just performs the actual exit.
        app.exit(0);
    });
    boServer = bo.server;
    // The BO creates/migrates the database first (see boServer.ts's bootstrapDatabase()): the
    // renderer's Init.vue then finds it ready instead of racing the BO's first sign-in for it.
    await bo.databaseReady;
    win = createSplashWin();
});

app.on('will-quit', () => {
    boServer?.close();
});

// Exit cleanly on request from parent process in development mode.
if (isDevelopment) {
    if (process.platform === 'win32') {
        process.on('message', data => {
            if (data === 'graceful-exit') {
                app.quit();
            }
        });
    } else {
        process.on('SIGTERM', () => {
            app.quit();
        });
        // Only under `electron-vite dev` (it sets ELECTRON_RENDERER_URL): this file also runs in the
        // packaged app, where a changed parent is normal and must never stop the app.
        if (process.env.ELECTRON_RENDERER_URL) {
            // Ctrl+C in the terminal running `just serve` (SIGINT) and a closed terminal (SIGHUP)
            // otherwise leave this process, and the BO with it, running.
            process.on('SIGINT', () => app.quit());
            process.on('SIGHUP', () => app.quit());
            // Dev server killed without any signal reaching us (SIGKILL, or only its `just`/`npm`
            // wrapper): see exitWhenParentGone(). exit(), not quit(): nothing left to wait for.
            exitWhenParentGone(() => app.exit(0));
        }
    }
}

function createSplashWin() {
    return createWindow({
        webPreferences: {
            webSecurity: false,
            nodeIntegration: true,
            contextIsolation: false,
            sandbox: false,
        },
        backgroundColor: '#000000',
        frame: false,
    }, 'init');
}
