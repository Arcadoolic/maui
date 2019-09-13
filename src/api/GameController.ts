import {Request, Response} from 'express';
import Game from '@/model/Game.model';
import Controller from "@/api/Controller";
import {BrowserWindow, IpcMain} from "electron";

export default class GameController extends Controller
{
    constructor(userDataPath: string, ipcMain: IpcMain, window: BrowserWindow) {
        super(userDataPath, ipcMain, window);
        this.getGames = this.getGames.bind(this);
        this.getGameById = this.getGameById.bind(this);
    }

    public getGames(request: Request, response: Response) {
        Game.findAll().then((games: Game[]) => {
            return response.json(games);
        });
    }

    public getGameById(request: Request, response: Response) {
        Game.findByPk(request.params.id).then((game: Game|null) => {
            if (game) {
                return response.json(game);
            }
            return response.status(404).json({success: false});
        })
    }
}
