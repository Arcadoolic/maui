import Game from './Game.class';

export default class GameCategory {
    protected id: string;
    protected name: string;
    protected games: Game[] = [];

    public constructor(gameCategoryData: GameCategoryJSON) {
        this.id = gameCategoryData.id;
        this.name = gameCategoryData.name;
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
