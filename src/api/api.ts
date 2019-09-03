import express from 'express';
import User from '../model/User.model';
import Database from "../class/Database.class";
import UserController from "@/api/UserController";
import GameController from "@/api/GameController";

export default function() {
    const api: express.Application = express();

    const db = new Database(); // Init db

    // Users routes
    api.get('/api/users', UserController.getUsers);
    api.get('/api/user/:id_user([0-9]+)', UserController.getUserById);

    api.get('/api/user/:id_user([0-9]+)/game/:id_game([0-9]+)/scores', UserController.getScoresByIdGame);

    // Games routes
    api.get('/api/games', GameController.getGames);
    api.get('/api/game/:id([0-9]+)', GameController.getGameById);

    api.use((req, res, next) => {
        if (!db.exist()) {
            return res.send({
                success: false,
                message: 'Database do not exist'
            });
        }
        return next();
    });
    api.listen(3000, () => {
        console.log('Express on port 3000!');
    });
}
