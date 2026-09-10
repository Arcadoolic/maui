import {join} from 'path';
import {readFileSync, readdirSync} from 'fs';
import {parse as iniParse} from 'ini';
import Game from '@/model/Game.model';
import MameService from '@/class/MameService.class';
import Category from '@/model/Category.model';
import HiscoreService from '@/class/HiscoreService.class';
import Log from 'electron-log';


declare const __static: string;

export default class GameService {
    protected static genreIni?: { [genre: string]: { [romName: string]: boolean } };
    protected static nplayersIni?: { [romName: string]: { [romName: string]: boolean } };

    protected static nplayersTranslation: { [k: string]: Nplayers } = {
        '12P sim': {sim: 12, alt: 0},
        '1P': {sim: 0, alt: 0},
        '2P alt': {sim: 0, alt: 2},
        '2P sim': {sim: 2, alt: 0},
        '3P alt': {sim: 0, alt: 3},
        '3P sim': {sim: 3, alt: 0},
        '4P alt': {sim: 0, alt: 4},
        '4P alt / 2P sim': {sim: 2, alt: 4},
        '4P sim': {sim: 4, alt: 0},
        '5P alt': {sim: 0, alt: 5},
        '6P alt': {sim: 0, alt: 6},
        '6P alt / 2P sim': {sim: 2, alt: 6},
        '6P sim': {sim: 6, alt: 0},
        '8P alt / 2P sim': {sim: 2, alt: 8},
        '8P sim': {sim: 8, alt: 0},
        '9P alt': {sim: 0, alt: 9},
    };

    protected games?: Game[];
    protected mameService!: MameService;
    protected hiService!: HiscoreService;

    public constructor(mameService: MameService, hiService: HiscoreService) {
        this.mameService = mameService;
        this.hiService = hiService;
    }

    /**
     * Save games in database
     * @param romNames
     */
    public async saveGamesFromRomNames(romNames: string[]) {
        const existingGames = (await Game.findAll()).map((game) => {
            return game.romName;
        });
        // TODO : What to do if rom is invalid ?
        const games: any[] = [];

        // Disable unwanted games
        const romToDisable = existingGames.filter((i) => romNames.indexOf(i) < 0);
        Game.destroy({ where: { romName: romToDisable }} );

        for (const romName of romNames) {
            if (existingGames.indexOf(romName) >= 0) {
                games.push({
                    romName,
                    hi: this.hiService.hasHiscore(romName),
                });
                continue;
            }

            // Get game information from mame
            const gameInformation = this.mameService.getGameInformation(romName);

            // Extract shortname and subname
            let shortname = gameInformation.description;
            let subname = '';
            const shortnameRegexp = /^(.[^(]*)/g.exec(gameInformation.description);
            if (shortnameRegexp) {
                shortname = shortnameRegexp[0].trim().replace(/&amp;/g, '&');
                const subnameRegexp = /^([^\-\/]*)(:\s+|\s+-\s+|\s+\/\s+)(.*)$/.exec(shortname);
                if (subnameRegexp) {
                    shortname = subnameRegexp.splice(0, 3)[1];
                    subname = subnameRegexp[0];
                }
            }

            // Get player numbers
            const players = this.getGameNplayers(romName);
            games.push({
                id_category: this.getGameCategoryId(romName),
                romName,
                fullname: gameInformation.description,
                shortname,
                subname,
                manufacturer: gameInformation.manufacturer,
                year: gameInformation.year,
                hi: this.hiService.hasHiscore(romName),
                player_alt: players.alt,
                player_sim: players.sim,
            });
        }
        await Game.bulkCreate(games, {
            updateOnDuplicate: ['hi'],
            logging: Log.log,
        });
    }

    /**
     * Load and parse genre.ini file
     */
    public getGameCategories() {
        if (!GameService.genreIni) {
            GameService.genreIni = iniParse(readFileSync(join(__static, 'data/genre_206.ini'), 'utf8'));
        }
        return GameService.genreIni;
    }

    /**
     * Return category id for a romName
     * @param romName
     */
    public getGameCategoryId(romName: string) {
        if (!GameService.genreIni) {
            GameService.genreIni = iniParse(readFileSync(join(__static, 'data/genre_206.ini'), 'utf8'));
        }
        const categories = Object.keys(GameService.genreIni);
        for (const category in GameService.genreIni) {
            if (GameService.genreIni[category][romName]) {
                return categories.indexOf(category) + 1;
            }
        }
    }

    /**
     * Get a game nplayers from nplayers.ini
     * @param romName
     */
    public getGameNplayers(romName: string): Nplayers {
        if (!GameService.nplayersIni) {
            GameService.nplayersIni = iniParse(readFileSync(join(__static, 'data/nplayers_206.ini'), 'utf8'));
        }
        for (const nplayers in GameService.nplayersIni) {
            if (GameService.nplayersIni[nplayers][romName]) {
                if (GameService.nplayersTranslation[nplayers]) {
                    return GameService.nplayersTranslation[nplayers];
                } else {
                    break;
                }
            }
        }

        return {
            sim: 0,
            alt: 0,
        };
    }

    /**
     * Load games from database
     */
    public async loadGames() {
        if (this.games === undefined) {
            this.games = await Game.findAll({
                order: ['romName'],
            });
        }
        return this.games;
    }

    /**
     * Load categories from database
     */
    public async loadCategories() {
        return await Category.findAll({
            order: ['name'],
            include: [{model: Game, required: true}],
        });
    }

    /**
     * Read marquees dir
     */
    public loadMarquees() {
        if (this.mameService.uiIni && this.mameService.uiIni.marquees_directory) {
            const marqueesDirectory = this.mameService.marqueePath;
            return marqueesDirectory ? readdirSync(marqueesDirectory) : [];
        }
        return [];
    }

    /**
     * Read flyers dir
     */
    public loadFlyers() {
        if (this.mameService.uiIni && this.mameService.uiIni.flyers_directory) {
            const flyerDirectory = this.mameService.flyerPath;
            return flyerDirectory ? readdirSync(flyerDirectory) : [];
        }
        return [];
    }
}
