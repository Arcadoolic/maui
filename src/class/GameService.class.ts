import Config from '@/class/Config.class';
import {join} from 'path';
import {existsSync} from 'fs';
import Mame from '@/class/Mame.class';
import Game from '@/class/Game.class';

export default class GameService {
    protected config!: Config;
    protected mame!: Mame;

    public constructor(config: Config, mame: Mame) {
        this.config = config;
        this.mame = mame;
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
            nplayers: {sim: 0, alt: 0},
            parent: '',
            categories: []
        };
        // Check if game.json does not exist si clean = false - DONE
        // Check si rom exist - DONE
        // Recup info avec mame --listxml (manufacturer, years, description => longname) - DONE
        // Recup categories de category.ini si existe
        // Recup nbplayer de nbplayer.ini si existe
    }
}
