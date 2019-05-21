'use strict';

import {app, protocol, BrowserWindow, ipcMain} from 'electron';
import {
    createProtocol,
    installVueDevtools
} from 'vue-cli-plugin-electron-builder/lib';
import BrowserWindowConstructorOptions = Electron.BrowserWindowConstructorOptions;

const isDevelopment = process.env.NODE_ENV !== 'production';

// Keep a global reference of the window object, if you don't, the window will
// be closed automatically when the JavaScript object is garbage collected.
let createdAppProtocol = false;
let win: BrowserWindow|null;

// Standard scheme must be registered before the app is ready
protocol.registerStandardSchemes(['app'], {secure: true});

function createWindow(options: BrowserWindowConstructorOptions, path): BrowserWindow {
    // Create the browser window.
    let winVar: BrowserWindow|null = new BrowserWindow(options);

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
        // Install Vue Devtools
        await installVueDevtools();
    }
    win = createSplashWin();
    ipcMain.on('init-end', () => {
        win!.hide();
        updateToMain(win!);
        win!.once('ready-to-show', () => {
            win!.show();
        });
    })
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

function updateToMain(win: BrowserWindow) {
    win.setFullScreen(true);
}

function createSplashWin() {
    return createWindow({
        width: 346,
        height: 354,
        webPreferences: {
            webSecurity: false
        },
        backgroundColor: '#000000',
        frame: false
    }, 'init');
}
