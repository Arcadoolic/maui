import GameCategory from './GameCategory.class';

export default class Game {
    protected fullname: string;
    protected shortname: string;
    protected subname: string;
    protected year: number;
    protected manufacturer: string;
    protected parent: string;
    protected nplayers: Nplayers;

    protected categories: GameCategory[] = [];

    protected romPath: string|null;

    /**
     * Init Game object from GameJSON data type
     * @param gameData
     * @param romPath
     */
    public constructor(gameData: GameJSON) {
        this.fullname = gameData.fullname;
        this.shortname = gameData.shortname;
        this.subname = gameData.subname;
        this.year = gameData.year;
        this.manufacturer = gameData.manufacturer;
        this.parent = gameData.parent;
        this.nplayers = gameData.nplayers;
        this.romPath = gameData.romPath;
    }

    /**
     * Set a GameCategory object to a game
     * @param category
     */
    public addCategory(category: GameCategory) {
        this.categories.push(category);
    }

    public get romName() {
        return this.romPath;
    }
}
