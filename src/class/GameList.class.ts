import GameCategory from './GameCategory.class';
import Game from './Game.class';
import {readFileSync, existsSync, readdirSync} from 'fs';
import {extname} from 'path';

export default class GameList {
    protected categories: GameCategory[] = [];
    protected categoriesById: { [id: string]: GameCategory } = {};
    protected games: Game[] = [];
    protected gameNames: string[] = [];

    public init(gamesPath: string) {
        this.initGames(gamesPath);
        this.sortGames();
    }

    /**
     *
     * @param gamesPath
     */
    public initGames(gamesPath: string) {
        this.games = [];
        this.categories = [];
        this.categoriesById = {};
        this.gameNames = [];

        this.categoriesById.all = new GameCategory('All');
        this.categories.push(this.categoriesById.all);
        if (!existsSync(gamesPath)) {
            return false;
        }
        const dir = readdirSync(gamesPath, 'utf8');
        for (const file of dir) {
            if (extname(file).toLowerCase() !== '.json') {
                continue;
            }
            this.addGame(JSON.parse(readFileSync(gamesPath + '/' + file, 'utf8')));
        }
    }

    /**
     * Add a game to a category
     * @param gameJson
     */
    public addGame(gameJson: GameJSON) {
        const game = new Game(gameJson);

        // Create cat if do not exist
        if (gameJson.category && !this.categoriesById[gameJson.category]) {
            const category = new GameCategory(gameJson.category);
            this.categoriesById[gameJson.category] = category;
            this.categories.push(category);
        }

        // Add game to his category
        if (gameJson.category) {
            this.categoriesById[gameJson.category].addGame(game);
            game.addCategory(this.categoriesById[gameJson.category]);
        }

        // Add game to category `all`
        this.categoriesById.all.addGame(game);
        game.addCategory(this.categoriesById.all);

        // Add Game to game list
        this.gameNames.push(game.romName);
        this.games.push(game);
    }

    public sortGames() {
        const sortFn = (a: Game, b: Game) => {
            if (a.shortname < b.shortname) {
                return -1;
            } else if (a.shortname > b.shortname) {
                return 1;
            } else {
                return 0;
            }
        };

        this.categories.forEach((category: GameCategory) => {
            category.getGames().sort(sortFn);
        });
    }

    /**
     * @return Game[]
     */
    public getGames() {
        return this.games;
    }

    /**
     * @return GameCategory[]
     */
    public getCategories() {
        return this.categories;
    }

    public getGameNames() {
        return this.gameNames;
    }
}
