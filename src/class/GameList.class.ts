import GameCategory from './GameCategory.class';
import Game from './Game.class';
import {readFileSync, existsSync, readdirSync} from 'fs';
import {extname} from 'path';

export default class GameList {
    protected categories: GameCategory[] = [];
    protected categoriesById: { [id: string]: GameCategory } = {};
    protected games: Game[] = [];

    /**
     * Init game categories
     * @param categoriesJsonPath
     */
    public initCategories(categoriesJsonPath: string) {
        this.categories = [];
        this.categoriesById = {};
        if (!existsSync(categoriesJsonPath)) {
            throw new Error('`categories.json` file not found');
        }
        const categoriesJson: GameCategoryJSON[] = JSON.parse(readFileSync(categoriesJsonPath, 'utf8'));
        this.categoriesById.all = new GameCategory({ name: 'All', id: 'all'});
        this.categories.push(this.categoriesById.all);
        for (const category of categoriesJson) {
            this.categoriesById[category.id] = new GameCategory(category);
            this.categories.push(this.categoriesById[category.id]);
        }
    }

    /**
     *
     * @param gamesPath
     */
    public initGames(gamesPath: string) {
        this.games = [];
        if (!existsSync(gamesPath)) {
            throw new Error(gamesPath + ' not founnd');
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
        // Categories
        for (const categoryId of gameJson.categories) {
            this.categoriesById.all.addGame(game);
            if (this.categoriesById[categoryId]) {
                game.addCategory(this.categoriesById[categoryId]);
                this.categoriesById[categoryId].addGame(game);
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

    /**
     * @return GameCategory[]
     */
    public getCategories() {
        return this.categories;
    }

    public createGamesFromNames(favorites: string[], clean = false) {
        for (const favorite of favorites) {
            const game = Game
            // Check if game.json does not exist si clean = false
            // Check si rom exist
            // Recup info avec mame --listxml (manufacturer, years, description => longname)
            // Recup categories de category.ini si existe
            // Recup nbplayer de nbplayer.ini si existe
        }
    }
}
