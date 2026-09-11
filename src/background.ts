'use strict';

import {app, protocol, BrowserWindow, ipcMain} from 'electron';
import * as remoteMain from '@electron/remote/main';
import {
    createProtocol,
    installVueDevtools
} from 'vue-cli-plugin-electron-builder/lib';
import BrowserWindowConstructorOptions = Electron.BrowserWindowConstructorOptions;
import {Server} from 'http';
import api from '@/api/api';
import {startBoServer} from '@/boServer';
import {BO_SERVER_PORT} from '@/boServerPort';
import Config from '@/class/Config.class';

remoteMain.initialize();

const isDevelopment = process.env.NODE_ENV !== 'production';

// Keep a global reference of the window object, if you don't, the window will
// be closed automatically when the JavaScript object is garbage collected.
let createdAppProtocol = false;
let win: BrowserWindow|null;
let boServer: Server|undefined;

// Standard scheme must be registered before the app is ready
protocol.registerSchemesAsPrivileged([
    {scheme: 'app', privileges: {secure: true, standard: true}}
]);

function loadPath(winVar: BrowserWindow, path: string) {
    if (process.env.WEBPACK_DEV_SERVER_URL) {
        // Load the url of the dev server if in development mode
        winVar.loadURL(process.env.WEBPACK_DEV_SERVER_URL as string + '#/' + path);
        if (!process.env.IS_TEST) {
            const config = new Config();
            config.load();
            if (config.openDevTools) {
                winVar.webContents.openDevTools();
            }
        }
    } else {
        if (!createdAppProtocol) {
            createProtocol('app');
            createdAppProtocol = true;
        }
        // Load the index.html when not in development
        winVar.loadURL('app://./index.html');
    }
}

function createWindow(options: BrowserWindowConstructorOptions, path): BrowserWindow {
    // Create the browser window.
    let winVar: BrowserWindow|null = new BrowserWindow(options);
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
    if (isDevelopment && !process.env.IS_TEST) {
        // Install Vue Devtools (non-blocking: the installer's promise can hang
        // indefinitely against the current Chrome Web Store, so don't await it)
        installVueDevtools().catch(error => {
            console.error('Failed to install Vue Devtools:', error);
        });
    }
    win = createSplashWin();
    // api(app.getPath('userData'), ipcMain, win);

    boServer = startBoServer(BO_SERVER_PORT, () => {
        if (win) {
            loadPath(win, 'init');
        }
    }, () => {
        // Unlike onConfigured() above (a route reload is enough after a normal config save), a
        // reset needs a real process restart: the renderer's Vuex store only ever builds its
        // MameService/GameService/... once (see store.ts's initServices), so those would keep
        // serving stale data - parsed from the mame home files /reset just deleted - even after
        // reloading to /init and going through first-run setup again.
        //
        // app.relaunch() is NOT used here: under `electron:serve` the app is a child process
        // orchestrated by vue-cli-plugin-electron-builder's dev server (WEBPACK_DEV_SERVER_URL
        // and friends), and relaunch()'s re-spawn doesn't reconnect to that setup - the process
        // just exits and nothing comes back. So the /reset response tells the user to close and
        // restart manually (`just serve` in dev; relaunching the packaged app otherwise), and
        // this just performs the actual exit.
        app.exit(0);
    });
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
            app.quit()
        })
    }
}

function createSplashWin() {
    return createWindow({
        webPreferences: {
            webSecurity: false,
            nodeIntegration: true,
            contextIsolation: false,
            sandbox: false
        },
        backgroundColor: '#000000',
        frame: false,
    }, 'init');
}
