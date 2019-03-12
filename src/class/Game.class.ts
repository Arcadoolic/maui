import GameCategory from './GameCategory.class';

export default class Game {
    protected _fullname: string;
    protected _shortname: string;
    protected _subname: string;
    protected _year: number;
    protected _manufacturer: string;
    protected _nplayers: Nplayers;
    protected _hi: boolean;

    protected _categories: GameCategory[] = [];

    protected _romName: string;

    protected _marquee: string = '';
    protected _flyer: string = '';

    /**
     * Init Game object from GameJSON data type
     * @param gameData
     * @param romPath
     */
    public constructor(gameData: GameJSON) {
        this._fullname = gameData.fullname;
        this._shortname = gameData.shortname;
        this._subname = gameData.subname;
        this._year = gameData.year;
        this._manufacturer = gameData.manufacturer;
        this._nplayers = gameData.nplayers;
        this._romName = gameData.romName;
        this._hi = gameData.hi;
    }

    /**
     * Set a GameCategory object to a game
     * @param category
     */
    public addCategory(category: GameCategory) {
        this._categories.push(category);
    }

    public get romName() {
        return this._romName;
    }

    public get fullname() {
        return this._fullname;
    }

    public get shortname() {
        return this._shortname;
    }

    public get year() {
        return this._year;
    }

    public get nplayerString() {
        let str = null;
        if (this._nplayers.alt) {
            str = this._nplayers.alt + ' player' + (this._nplayers.alt > 1 ? 's' : '') + ' alternate';
        }
        if (this._nplayers.sim) {
            str = (str)
                ? str + '/' + this._nplayers.sim + ' player' + (this._nplayers.sim > 1 ? 's' : '') + ' simultaneous'
                : this._nplayers.sim + ' player' + (this._nplayers.sim > 1 ? 's' : '') + ' simultaneous';
        }
        if (!str) {
            str = '1 player';
        }
        return str;
    }

    public set marquee(marquee: string) {
        this._marquee = marquee;
    }

    public get marquee(): string {
        return this._marquee;
    }

    public set flyer(flyer: string) {
        this._flyer = flyer;
    }

    public get flyer(): string {
        return this._flyer;
    }

    public get hasHiscore(): boolean {
        return this._hi;
    }
}
