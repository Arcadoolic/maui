import Config from '@/class/Config.class';
import {join} from 'path';
import {existsSync, readFileSync, readdirSync} from 'fs';
import {parse as iniParse} from 'ini';
import Game from '@/model/Game.model';
import MameService from '@/class/MameService.class';
import Helpers from '@/class/Helpers.class';
import Category from '@/model/Category.model';

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

    protected config!: Config;
    protected mameService!: MameService;

    public constructor(config: Config, mameService: MameService) {
        this.config = config;
        this.mameService = mameService;
    }

    public async saveGamesFromRomNames(romNames: string[]) {
        const existingGames = (await Game.findAll()).map((game) => {
            return game.romName;
        });
        // TODO : What to do if rom is invalid ?
        const games: any[] = [];
        for (const romName of romNames) {
            if (existingGames.indexOf(romName) >= 0) {
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
                hi: this.hasGameHaveHi2txt(romName),
                player_alt: players.alt,
                player_sim: players.sim,
            });
        }
        await Game.bulkCreate(games);
    }

    public getGameCategories() {
        if (!GameService.genreIni) {
            GameService.genreIni = iniParse(readFileSync(join(__static, 'data/genre_206.ini'), 'utf8'));
        }
        return GameService.genreIni;
    }

    public getGameCategoryId(romName: string) {
        if (!GameService.genreIni) {
            GameService.genreIni = iniParse(readFileSync(join(__static, 'data/genre_206.ini'), 'utf8'));
        }
        const categories = Object.keys(GameService.genreIni);
        for (const category in GameService.genreIni) {
            if (GameService.genreIni[category][romName]) {
                return categories.indexOf(category);
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
     * Check if game.xml exist in hi2txt
     * @param romName
     */
    public hasGameHaveHi2txt(romName: string): boolean {
        const hi2txtPath = join(process.env.NODE_ENV === 'development'
            ? './resources' : process.resourcesPath!, 'hi2txt');
        return existsSync(join(hi2txtPath, 'hi2txt', romName + '.xml'));
    }

    public async loadGames() {
        return await Game.findAll({
            order: ['romName'],
        });
    }

    public async loadCategories() {
        return await Category.findAll({
            order: ['name'],
        });
    }

    public loadMarquees() {
        if (this.mameService.uiIni && this.mameService.uiIni.marquees_directory) {
            const marqueesDirectory = this.mameService.marqueePath;
            return marqueesDirectory ? readdirSync(marqueesDirectory) : [];
        }
        return [];
    }

    // public gameJsonFromRomName(romName: string): GameJSON {
    //     const fileName = romName + '.json';
    //     if (!this.mame.isRomValid(romName)) {
    //         throw new Error('Rom not valid');
    //     }
    //
    //     const infoFromMameXml = this.mame.getGameInfoFromMameXML(romName);
    //     if (!infoFromMameXml) {
    //         throw new Error('Cant get xml');
    //     }
    //
    //     const shortnameRegexp = /^(.[^\(]*)/g.exec(infoFromMameXml.description);
    //     let shortname: string | null = null;
    //     let subname: string | null = null;
    //     if (shortnameRegexp) {
    //         shortname = shortnameRegexp[0].trim().replace(/&amp;/g, '&');
    //         const subnameRegexp = /^([^\-\/]*)(:\s+|\s+\-\s+|\s+\/\s+)(.*)$/.exec(shortname);
    //         if (subnameRegexp) {
    //             shortname = subnameRegexp.splice(0, 3)[1];
    //             subname = subnameRegexp[0];
    //         }
    //     }
    //     return {
    //         fullname: infoFromMameXml.description,
    //         shortname: shortname || '',
    //         subname: subname || '',
    //         manufacturer: infoFromMameXml.manufacturer,
    //         year: infoFromMameXml.year,
    //         hi: this.isGameHaveHiscore(romName),
    //         romName,
    //         nplayers: this.getGameNplayers(romName),
    //         category: this.getGameGenre(romName),
    //         parent: this.mame.getRomParent(romName),
    //     };
    // }

    // public loadGamesMarquee() {
    //     const marqueesPath = Helpers.getFirstExistingDirectory(
    //         this.mame.mameUiConfig.marquees_directory,
    //         this.mame.mameUiPath);
    //
    //     if (!marqueesPath) {
    //         throw new Error('Cannot find marquees directory - ' + this.mame.mameUiConfig.marquees_directory.join('|'));
    //     }
    //
    //     for (const game of this.gameList.getGames()) {
    //         const marqueePath = join(marqueesPath, game.romName + '.png');
    //         const parentMarqueePath = join(marqueesPath, game.parent + '.png');
    //
    //         let path: string | null = null;
    //         if (existsSync(marqueePath)) {
    //             path = marqueePath;
    //         } else if (existsSync(parentMarqueePath)) {
    //             path = parentMarqueePath;
    //         }
    //
    //         if (path) {
    //             game.marquee = format({
    //                 pathname: path,
    //                 protocol: 'file',
    //                 slashes: true,
    //             });
    //         }
    //     }
    // }

    // public loadGamesFlyers() {
    //     const flyersPath = Helpers.getFirstExistingDirectory(
    //         this.mame.mameUiConfig.flyers_directory,
    //         this.mame.mameUiPath);
    //     if (!flyersPath) {
    //         throw new Error('Cannot find flyers directory ' + this.mame.mameUiConfig.flyers_directory.join('|'));
    //     }
    //
    //     for (const game of this.gameList.getGames()) {
    //         const flyerPath = join(flyersPath, game.romName + '.png');
    //         const parentFlyerPath = join(flyersPath, game.parent + '.png');
    //
    //         let path: string | null = null;
    //         if (existsSync(flyerPath)) {
    //             path = flyerPath;
    //         } else if (existsSync(parentFlyerPath)) {
    //             path = parentFlyerPath;
    //         }
    //
    //         if (path) {
    //             game.flyer = format({
    //                 pathname: path,
    //                 protocol: 'file',
    //                 slashes: true,
    //             });
    //         }
    //     }
    // }

}
