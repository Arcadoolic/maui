import {Request, Response} from 'express';
import User from '@/model/User.model';
import Hiscore from '@/model/Hiscore.model';
import Controller from "@/api/Controller";
import {IpcMain, BrowserWindow} from 'electron'

export default class UserController extends Controller
{
    constructor(userDataPath: string, ipcMain: IpcMain, window: BrowserWindow) {
        super(userDataPath, ipcMain, window);
        this.getUsers = this.getUsers.bind(this);
        this.getUserById = this.getUserById.bind(this);
        this.getScoresByIdGame = this.getScoresByIdGame.bind(this);
    }

    public getUsers(request: Request, response: Response) {
        User.findAll().then((users: User[]) => {
            return response.json(users)
        });
    }

    public getUserById(request: Request, response: Response) {
        User.findByPk(request.params.id_user).then((user: User|null) => {
            if (user) {
                return response.json(user);
            }
            return response.status(404).json({success: false});
        });
    }

    public getScoresByIdGame(request: Request, response: Response) {
        Hiscore.findAll({
            where: {
                id_user: request.params.id_user,
                id_game: request.params.id_game
            },
            order: [['score', 'DESC']],
            group: ['score']
        }).then((scores: Hiscore[]) => {
            return response.json(scores);
        })
    }
}
