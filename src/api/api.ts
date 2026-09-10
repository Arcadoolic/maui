import express from 'express';
import Database from '@/class/Database.class';
import UserController from '@/api/UserController';
import GameController from '@/api/GameController';
import IpcMain = Electron.IpcMain;
import BrowserWindow = Electron.BrowserWindow;

export default function(userDataPath: string, ipcMain: IpcMain, window: BrowserWindow) {
    const api: express.Application = express();

    const db = new Database(userDataPath); // Init db

    // Users routes
    const userController = new UserController(userDataPath, ipcMain, window);
    api.get('/api/users', userController.getUsers);
    api.get('/api/user/:id_user([0-9]+)', userController.getUserById);
    api.get('/api/user/:id_user([0-9]+)/game/:id_game([0-9]+)/scores', userController.getScoresByIdGame);

    // Games routes
    const gameController = new GameController(userDataPath, ipcMain, window);
    api.get('/api/games', gameController.getGames);
    api.get('/api/game/:id([0-9]+)', gameController.getGameById);

    api.use((req, res, next) => {
        if (!db.exist()) {
            return res.end({
                success: false,
                message: 'Database do not exist',
            });
        }
        return next();
    });
    api.listen(3000, () => {
        console.log('Express on port 3000!');
    });
}
