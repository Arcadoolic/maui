import {existsSync} from 'fs';
import GameCategory from './GameCategory.class';

export default class Game {
    protected fullname: string;
    protected shortname: string;
    protected subname: string;
    protected year: number;
    protected manufacturer: string;
    protected parent: string;
    protected category: string;
    protected nplayers: string;

    protected categories: GameCategory[] = [];

    protected romPath: string|null;

    /**
     * Init Game object from GameJSON data type
     * @param gameData
     * @param romPath
     */
    public constructor(gameData: GameJSON, romPath: string) {
        this.fullname = gameData.fullname;
        this.shortname = gameData.shortname;
        this.subname = gameData.subname;
        this.year = gameData.year;
        this.manufacturer = gameData.manufacturer;
        this.parent = gameData.parent;
        this.category = gameData.category;
        this.nplayers = gameData.nplayers;

        this.romPath = null;
        if (!existsSync(romPath)) {
            this.romPath = romPath;
        }
    }

    /**
     * Set a GameCategory object to a game
     * @param category
     */
    public addCategory(category: GameCategory) {
        this.categories.push(category);
    }

}
