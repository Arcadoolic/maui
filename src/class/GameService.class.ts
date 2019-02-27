import Config from '@/class/Config.class';
import {join} from 'path';
import {existsSync, readFileSync} from 'fs';
import Mame from '@/class/Mame.class';
import Game from '@/class/Game.class';
import {parse as iniParse} from 'ini';

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


    public constructor(config: Config, mame: Mame) {
        this.config = config;
        this.mame = mame;
    }

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

    public getGameNplayers(romName: string): Nplayers {
        if (!GameService.nplayersIni) {
            GameService.nplayersIni = iniParse(readFileSync(join(__static, 'data/nplayers_206.ini'), 'utf8'));
        }
        for (let nplayers in GameService.nplayersIni) {
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

    public gameFromRomName(romName: string, force: boolean = false) {
        const fileName = romName + '.json';
        if (!force && existsSync(join(this.config.gamesJsonPath, fileName))) {
            console.log('Already exist');
            return false;
        }

        if (!this.mame.isRomValid(romName)) {
            console.log('Rom not valid');
            return false;
        }

        const infoFromMameXml = this.mame.getGameInfoFromMameXML(romName);
        if (!infoFromMameXml) {
            console.log('Cant get xml');
            return false;
        }

        const regexp = /^(.[^\(]+)/g;
        const shortname = regexp.exec(infoFromMameXml.description);
        return {
            fullname: infoFromMameXml.description,
            shortname: shortname ? shortname[0].trim() : infoFromMameXml.description,
            subname: '',
            manufacturer: infoFromMameXml.manufacturer,
            year: infoFromMameXml.year,
            hi: true,
            romName: romName,
            nplayers: this.getGameNplayers(romName),
            category: this.getGameGenre(romName),
        };
        // Check if game.json does not exist si clean = false - DONE
        // Check si rom exist - DONE
        // Recup info avec mame --listxml (manufacturer, years, description => longname) - DONE
        // Recup categories de category.ini si existe - DONE
        // Recup nbplayer de nbplayer.ini si existe - DONE
    }
}
