'use strict';

import {app, BrowserWindow} from 'electron';
import * as remoteMain from '@electron/remote/main';
import BrowserWindowConstructorOptions = Electron.BrowserWindowConstructorOptions;
import {join} from 'path';
import {homedir} from 'os';
import {Server} from 'http';
import {startBoServer} from '@/boServer';
import {BO_SERVER_PORT} from '@/boServerPort';
import type {OnlineSession} from '@/class/OnlineSession';
import {onlineIndicator} from '@/class/OnlineSetup';
import {ONLINE_INDICATOR_GLOBAL, type OnlineIndicatorReader} from '@/class/OnlineIndicatorBridge';
import {LEADERBOARDS_CHANGED_CHANNEL, PLAY_ENDED_GLOBAL, PLAY_STARTED_GLOBAL, type PlayNotifier} from '@/class/ScoreCaptureBridge';
import Config from '@/class/Config.class';
import {integrateDesktop} from '@/class/DesktopIntegration';
import {exitWhenParentGone} from '@/devParentWatch';
import {getAppIconPath} from '@/staticPath';

remoteMain.initialize();

const isDevelopment = process.env.NODE_ENV !== 'production';

// Keep a global reference of the window object, if you don't, the window will
// be closed automatically when the JavaScript object is garbage collected.
let win: BrowserWindow | null;
let boServer: Server | undefined;
let onlineSession: OnlineSession | undefined;

// Read by the front's ONLINE badge (OnlineBadge.vue) through @electron/remote.
const readOnlineIndicator: OnlineIndicatorReader = () => onlineIndicator(onlineSession?.getStatus());
(global as Record<string, unknown>)[ONLINE_INDICATOR_GLOBAL] = readOnlineIndicator;

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

// A Linux AppImage is run without being installed: it adds itself to the applications menu and to
// the desktop (DesktopIntegration.ts). APPIMAGE is set by the AppImage's runtime, so the cabinet's
// extracted ~/squashfs-root is left alone.
function integrateAppImage(): void {
    const appImagePath = process.env.APPIMAGE;
    if (process.platform !== 'linux' || !app.isPackaged || !appImagePath) {
        return;
    }
    try {
        integrateDesktop({
            appImagePath,
            iconSourcePath: getAppIconPath(),
            name: 'MAUI',
            comment: 'Awesome Frontend for Mame !',
            homeDir: homedir(),
            env: process.env,
        });
    } catch (error) {
        // Never worth keeping the application from starting.
        console.error('[background] Desktop integration failed:', error);
    }
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
    integrateAppImage();
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
    onlineSession = bo.online;
    // Games started and ended by the front (Home.vue): their new scores go to MAUI-API.
    const playStarted: PlayNotifier = romName => bo.scores.started(romName);
    const playEnded: PlayNotifier = romName => bo.scores.ended(romName);
    (global as Record<string, unknown>)[PLAY_STARTED_GLOBAL] = playStarted;
    (global as Record<string, unknown>)[PLAY_ENDED_GLOBAL] = playEnded;
    // New shared leaderboards (LeaderboardSync.ts): the front reads them again (LeaderboardSource.ts).
    bo.leaderboards.onChange(() => win?.webContents.send(LEADERBOARDS_CHANGED_CHANNEL));
    // Not awaited: ONLINE must never delay the window (start() never throws, see OnlineSession.ts).
    void onlineSession.start();
    win = createSplashWin();
});

app.on('will-quit', () => {
    onlineSession?.stop();
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
        // Linux only: see getAppIconPath().
        ...(process.platform === 'linux' ? {icon: getAppIconPath()} : {}),
    }, 'init');
}
