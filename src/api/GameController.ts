import {Request, Response} from 'express';
import Game from '@/model/Game.model';

export default class GameController
{
    public static getGames(request: Request, response: Response) {
        Game.findAll().then((games: Game[]) => {
            return response.json(games);
        });
    }

    public static getGameById(request: Request, response: Response) {
        Game.findByPk(request.params.id).then((game: Game|null) => {
            if (game) {
                return response.json(game);
            }
            return response.status(404).json({success: false});
        })
    }
}
