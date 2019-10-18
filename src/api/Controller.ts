import IpcMain = Electron.IpcMain;
import BrowserWindow = Electron.BrowserWindow;

export default class Controller {
    protected userDataPath!: string;
    protected ipcMain!: IpcMain;
    protected window!: BrowserWindow;

    constructor(userDataPath: string, ipcMain: IpcMain, window: BrowserWindow) {
        this.userDataPath = userDataPath;
        this.ipcMain = ipcMain;
        this.window = window;
    }
}
