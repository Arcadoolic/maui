import {Request, Response} from "express";
import User from "@/model/User.model";
import Hiscore from "@/model/Hiscore.model";

export default class UserController
{
    public static getUsers(request: Request, response: Response) {
        User.findAll().then((users: User[]) => {
            return response.json(users)
        });
    }

    public static getUserById(request: Request, response: Response) {
        User.findByPk(request.params.id_user).then((user: User|null) => {
            if (user) {
                return response.json(user);
            }
            return response.status(404).json({success: false});
        });
    }

    public static getScoresByIdGame(request: Request, response: Response) {
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
