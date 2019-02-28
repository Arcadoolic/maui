import Game from './Game.class';

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
}
