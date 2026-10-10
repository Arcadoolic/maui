'use strict';

import {app, BrowserWindow} from 'electron';
import * as remoteMain from '@electron/remote/main';
import BrowserWindowConstructorOptions = Electron.BrowserWindowConstructorOptions;
import {join} from 'path';
import {homedir} from 'os';
import {startCore, type StartedCore} from '@/boCore';
import {BO_URL_GLOBAL, BO_WAKE_GLOBAL, type BoUrlReader, type BoWaker} from '@/class/BoWakeBridge';
import {BO_SERVER_PORT} from '@/boServerPort';
import type {OnlineSession} from '@/class/OnlineSession';
import {onlineIndicator} from '@/class/OnlineSetup';
import {ONLINE_INDICATOR_GLOBAL, type OnlineIndicatorReader} from '@/class/OnlineIndicatorBridge';
import {
    LEADERBOARDS_CHANGED_CHANNEL, PLAY_ENDED_GLOBAL, PLAY_STARTED_GLOBAL, SCORE_ATTRIBUTE_GLOBAL,
    type PlayEndNotifier, type PlayNotifier, type ScoreAttributor,
} from '@/class/ScoreCaptureBridge';
import {SHOW_GAME_CHANNEL} from '@/class/FrontShowGameBridge';
import Config from '@/class/Config.class';
import {integrateDesktop} from '@/class/DesktopIntegration';
import {exitWhenParentGone} from '@/devParentWatch';
import {getAppIconPath} from '@/staticPath';
import {totalmem} from 'os';
import {isKioskLayout} from '@/class/KioskRestart';
import {applyDisplayMode} from '@/class/DisplayMode';
import {resolveUiMode} from '@/class/UiMode';

remoteMain.initialize();

const isDevelopment = process.env.NODE_ENV !== 'production';

// Keep a global reference of the window object, if you don't, the window will
// be closed automatically when the JavaScript object is garbage collected.
let win: BrowserWindow | null;
let core: StartedCore | undefined;
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

// The screen mode of a dedicated cabinet (DisplayMode.ts), before any window opens. Only there, on
// its bare X session: a desktop's own screen settings are never touched.
function setCabinetDisplayMode(): void {
    if (!isKioskLayout(app.isPackaged) || !process.env.DISPLAY || process.env.WAYLAND_DISPLAY) {
        return;
    }
    try {
        const config = new Config();
        config.load();
        // The GPU's status is not known this early: the memory alone tells Lite here (UiMode.ts).
        const lite = resolveUiMode(config.uiMode, {totalMemBytes: totalmem()}) === 'lite';
        const mode = applyDisplayMode(config.displayMode, lite);
        if (mode) {
            console.log(`[background] Screen mode set to ${mode.width}x${mode.height}`);
        }
    } catch (error) {
        // Never worth keeping the application from starting.
        console.error('[background] Screen mode not set:', error);
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
    setCabinetDisplayMode();
    // What always runs, and the BO's port: the BO itself is loaded by its first request (boCore.ts).
    const bo = startCore(BO_SERVER_PORT, () => {
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
    }, (romName) => {
        // The BO's Favorites tab: the front moves to this game (Home.vue).
        if (!win || win.isDestroyed()) {
            return false;
        }
        win.webContents.send(SHOW_GAME_CHANNEL, romName);
        return true;
    });
    core = bo;
    // The database is created/migrated first (see boCore.ts's bootstrapDatabase()): the
    // renderer's Init.vue then finds it ready instead of racing the BO's first sign-in for it.
    await bo.databaseReady;
    onlineSession = bo.online;
    // Games started and ended by the front (Home.vue): their new scores go to MAUI-API.
    const playStarted: PlayNotifier = romName => bo.scores.started(romName);
    const playEnded: PlayEndNotifier = async (romName) => {
        const ask = await bo.scores.ended(romName);
        return ask ? JSON.stringify(ask) : null;
    };
    // The player picked on the cabinet for a score the game wrote without a name (WhoPlayedModal.vue).
    const attributeScore: ScoreAttributor = (romName, score, playerId) => bo.scores.attribute(romName, score, playerId);
    (global as Record<string, unknown>)[PLAY_STARTED_GLOBAL] = playStarted;
    (global as Record<string, unknown>)[PLAY_ENDED_GLOBAL] = playEnded;
    (global as Record<string, unknown>)[SCORE_ATTRIBUTE_GLOBAL] = attributeScore;
    // New shared leaderboards (LeaderboardSync.ts): the front reads them again (LeaderboardSource.ts).
    bo.leaderboards.onChange(() => win?.webContents.send(LEADERBOARDS_CHANGED_CHANNEL));
    // The cabinet's own way to the BO (Home.vue): loads it and tells where it is.
    const wakeBackOffice: BoWaker = async () => {
        try {
            await bo.bo.wake();
        } catch (error) {
            // The URL is still worth showing: the request made to it reports the failure (503).
            console.error('[background] Back office not loaded:', error);
        }
        return bo.getUrl();
    };
    (global as Record<string, unknown>)[BO_WAKE_GLOBAL] = wakeBackOffice;
    // Read by the first-run screen and the empty game list (useBoUrl.ts).
    const readBackOfficeUrl: BoUrlReader = () => bo.getUrl();
    (global as Record<string, unknown>)[BO_URL_GLOBAL] = readBackOfficeUrl;
    // Not awaited: ONLINE must never delay the window (start() never throws, see OnlineSession.ts).
    void bo.online.start();
    win = createSplashWin();
});

app.on('will-quit', () => {
    onlineSession?.stop();
    core?.close();
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
