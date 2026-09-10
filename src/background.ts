'use strict';

import {app, protocol, BrowserWindow, ipcMain} from 'electron';
import * as remoteMain from '@electron/remote/main';
import {
    createProtocol,
    installVueDevtools
} from 'vue-cli-plugin-electron-builder/lib';
import BrowserWindowConstructorOptions = Electron.BrowserWindowConstructorOptions;
import api from '@/api/api';
import Config from '@/class/Config.class';
import {startBoServer} from '@/boServer';
import {BO_SERVER_PORT} from '@/boServerPort';

remoteMain.initialize();

const isDevelopment = process.env.NODE_ENV !== 'production';

// Keep a global reference of the window object, if you don't, the window will
// be closed automatically when the JavaScript object is garbage collected.
let createdAppProtocol = false;
let win: BrowserWindow|null;

// Standard scheme must be registered before the app is ready
protocol.registerSchemesAsPrivileged([
    {scheme: 'app', privileges: {secure: true, standard: true}}
]);

function loadPath(winVar: BrowserWindow, path: string) {
    if (process.env.WEBPACK_DEV_SERVER_URL) {
        // Load the url of the dev server if in development mode
        winVar.loadURL(process.env.WEBPACK_DEV_SERVER_URL as string + '#/' + path);
        if (!process.env.IS_TEST) {
            winVar.webContents.openDevTools();
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

    const config = new Config(app.getPath('userData'));
    if (!config.exist()) {
        startBoServer(app.getPath('userData'), BO_SERVER_PORT, () => {
            if (win) {
                loadPath(win, 'init');
            }
        });
    }
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
