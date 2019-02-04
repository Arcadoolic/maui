import Game from './Game.class';

export default class GameCategory {
    protected id: string;
    protected name: string;
    protected games: Game[] = [];

    public constructor(gameCategoryData: GameCategoryJSON) {
        this.id = gameCategoryData.id;
        this.name = gameCategoryData.name;
    }

    public addGame(game: Game) {
        this.games.push(game);
    }
}
