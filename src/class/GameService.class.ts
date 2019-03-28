import Config from '@/class/Config.class';
import {join} from 'path';
import {existsSync, readFileSync, mkdirSync, unlinkSync, writeFileSync} from 'fs';
import Mame from '@/class/Mame.class';
import {parse as iniParse} from 'ini';
import GameList from '@/class/GameList.class';
import {format} from 'url';
import Helpers from '@/class/Helpers.class';
import HiScore from '@/class/HiscoreService.class';
import HiscoreService from '@/class/HiscoreService.class';

declare const __static: string;

export default class GameService {
    protected static genreIni?: {[genre: string]: {[romName: string]: boolean}};
    protected static nplayersIni?: {[romName: string]: {[romName: string]: boolean}};

    protected static nplayersTranslation: {[k: string]: Nplayers} = {
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
    protected mame!: Mame;
    protected gameList!: GameList;
    protected hiscores!: HiscoreService;


    public constructor(config: Config, mame: Mame, gameList: GameList, hiscores: HiscoreService) {
        this.config = config;
        this.mame = mame;
        this.gameList = gameList;
        this.hiscores = hiscores;
    }

    /**
     * Get a game genre from genre.ini file
     * @param romName
     */
    public getGameGenre(romName: string) {
        if (!GameService.genreIni) {
            GameService.genreIni = iniParse(readFileSync(join(__static, 'data/genre_206.ini'), 'utf8'));
        }
        for (const genre in GameService.genreIni) {
            if (GameService.genreIni[genre][romName]) {
                return genre;
            }
        }
        return null;
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
    public isGameHaveHiscore(romName: string): boolean {
        const hi2txtPath = join(process.env.NODE_ENV === 'development'
            ? './resources' : process.resourcesPath!, 'hi2txt');
        return existsSync(join(hi2txtPath, 'hi2txt', romName + '.xml'));
    }

    /**
     * Create a Game object from a rom name
     * @param romName
     * @param force
     */
    public gameJsonFromRomName(romName: string): GameJSON {
        const fileName = romName + '.json';
        if (!this.mame.isRomValid(romName)) {
            throw new Error('Rom not valid');
        }

        const infoFromMameXml = this.mame.getGameInfoFromMameXML(romName);
        if (!infoFromMameXml) {
            throw new Error('Cant get xml');
        }

        const shortnameRegexp = /^(.[^\(]*)/g.exec(infoFromMameXml.description);
        let shortname: string|null = null;
        let subname: string|null = null;
        if (shortnameRegexp) {
            shortname = shortnameRegexp[0].trim().replace(/&amp;/g, '&');
            const subnameRegexp = /^([^\-\/]*)(:\s+|\s+\-\s+|\s+\/\s+)(.*)$/.exec(shortname);
            if (subnameRegexp) {
                shortname = subnameRegexp.splice(0, 3)[1];
                subname = subnameRegexp[0];
            }
        }
        return {
            fullname: infoFromMameXml.description,
            shortname: shortname || '',
            subname: subname || '',
            manufacturer: infoFromMameXml.manufacturer,
            year: infoFromMameXml.year,
            hi: this.isGameHaveHiscore(romName),
            romName,
            nplayers: this.getGameNplayers(romName),
            category: this.getGameGenre(romName),
        };
    }

    /**
     * Delete game.json if no more in favorite and add new ones
     * @param force
     */
    public refreshGameDir(force = false) {
        if (!existsSync(this.config.gamesJsonPath)) {
            mkdirSync(this.config.gamesJsonPath);
        }
        const favoriteList = this.mame.getFavorites();

        const toDelete = this.gameList.getGameNames().filter((i) => {
            return favoriteList.indexOf(i) < 0;
        });
        for (const gameName of toDelete) {
            unlinkSync(join(this.config.gamesJsonPath, gameName + '.json'));
        }

        const errors: {[romName: string]: Error} = {};
        for (const romName of favoriteList) {
            if (!force && existsSync(join(this.config.gamesJsonPath, romName + '.json'))) {
                continue;
            }
            try {
                const game = this.gameJsonFromRomName(romName);
                writeFileSync(join(this.config.gamesJsonPath, game.romName + '.json'), JSON.stringify(game));
            } catch (e) {
                errors[romName] = e;
            }
        }
        return errors;
    }

    public loadGamesMarquee() {
        const marqueesPath = Helpers.getFirstExistingDirectory(
            this.mame.mameUiConfig.marquees_directory,
            this.mame.mameUiPath);

        if (!marqueesPath) {
            throw new Error('Cannot find marquees directory - ' + this.mame.mameUiConfig.marquees_directory.join('|'));
        }

        for (const game of this.gameList.getGames()) {
            const marqueePath = join(marqueesPath, game.romName + '.png');

            if (existsSync(marqueePath)) {
                game.marquee = format({
                    pathname: marqueePath,
                    protocol: 'file',
                    slashes: true,
                });
            }
        }
    }

    public loadGamesFlyers() {
        const flyersPath = Helpers.getFirstExistingDirectory(
            this.mame.mameUiConfig.flyers_directory,
            this.mame.mameUiPath);
        if (!flyersPath) {
            throw new Error('Cannot find flyers directory ' + this.mame.mameUiConfig.flyers_directory.join('|'));
        }

        for (const game of this.gameList.getGames()) {
            const flyerPath = join(flyersPath, game.romName + '.png');
            if (existsSync(flyerPath)) {
                game.flyer = format({
                    pathname: flyerPath,
                    protocol: 'file',
                    slashes: true,
                });
            }
        }
    }

    public loadHiscores() {
        if (!existsSync(this.config.hiscoresJsonPath)) {
            mkdirSync(this.config.hiscoresJsonPath);
        }

        for (const game of this.gameList.getGames()) {
            if (!game.hasHiscore) {
                continue;
            }
            this.hiscores.saveHiscore(game.romName).then(
                (hiscores) => {
                    game.hiscores = hiscores as {classic: Array<unknown>, advanced: Array<unknown>};
                },
                (error) => {
                    console.error('Error : hiscores on rom ' + game.romName);
                },
            );
        }
    }

}
