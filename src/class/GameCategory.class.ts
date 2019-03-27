import Game from './Game.class';
import {existsSync} from 'fs';
import {join} from 'path';
import {format} from 'url';

declare const __static: string;

export default class GameCategory {
        protected name: string;
    protected games: Game[] = [];

    public constructor(name: string) {
        this.name = name;
    }

    /**
     * Add a game to the category
     * @param game
     */
    public addGame(game: Game) {
        this.games.push(game);
    }

    /**
     * @return game[]
     */
    public getGames(): Game[] {
        return this.games;
    }

    public get iconPath(): string {
        const path = join(__static, 'categories', this.name.replace(/\W+/, '_').toLowerCase() + '.svg')
        const url = format({
            pathname: path,
            protocol: 'file',
            slashes: true,
        });
        if (existsSync(path)) {
            return url;
        }
        return join(process.env.BASE_URL!, 'categories', '_default.svg');
    }
}
