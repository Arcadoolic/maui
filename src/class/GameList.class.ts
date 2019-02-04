import GameCategory from './GameCategory.class';
import Game from './Game.class';
import {existsSync} from 'fs';

export default class GameList {
    protected categories: { [id: string]: GameCategory } = {};
    protected games: Game[] = [];

    /**
     * Init game categories
     * @param categoriesJsonPath
     */
    public initCategories(categoriesJsonPath: string) {
        if (!existsSync(categoriesJsonPath)) {
            throw new Error('`categories.json` file not found');
        }
        const categoriesJson: GameCategoryJSON[] = require(categoriesJsonPath);
        for (const category of categoriesJson) {
            this.categories[category.id] = new GameCategory(category);
        }
    }

    /**
     * Add a game to a category
     * @param gameJson
     */
    public addGame(gameJson: GameJSON) {
        const game = new Game(gameJson, './abc.rom');
        // Categories
        for (const categoryId of gameJson.categories) {
            if (this.categories[categoryId]) {
                game.addCategory(this.categories[categoryId]);
                this.categories[categoryId].addGame(game);
            }
        }
        this.games.push(game);
    }

    /**
     * @return Game[]
     */
    public getGames() {
        return this.games;
    }
}
