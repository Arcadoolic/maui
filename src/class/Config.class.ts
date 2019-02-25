import {existsSync, readFileSync} from 'fs';

export default class Config {
    protected _defaultMameIni: string = '/etc/mame/mame.ini';

    protected _configLoaded: boolean = false;
    protected _mameIniPath?: string;
    protected _mameIni?: {[key:string]: string|number|string[]|number[]} = {};
    protected _gamesJsonPath?: string;

    public constructor() {
        this.load();
    }

    public get isConfigLoaded() {
        return this._configLoaded;
    }

    public load() {
        if (existsSync('./config.json')) {
            const configFile = JSON.parse(readFileSync('./config.json', 'utf8'));
            this._mameIniPath = configFile.mameIniPath;
            if (!this.loadMameIni()) {
                throw new Error('Load of mame.ini failed. Given path ' + this._mameIniPath);
            }
                this._gamesJsonPath = configFile.gamesJsonPath;
            this._configLoaded = true;
            return true;
        }
        return false;
    }

    public save() {
        // Ici on ecrit le ficher de config
    }

    public loadMameIni() {
        if (!this._mameIniPath || !existsSync(this._mameIniPath)) {
            return false;
        }
        const regex = new RegExp(/^([a-z_]+)\s+(.+)$/);
        const file = readFileSync(this._mameIniPath, 'utf8').split('\n');
        file.forEach((line) => {
            if (line[0] === '#') { // Skip comments
                return true;
            }
            const data = regex.exec(line);
            if (data) {
                const value = data[2].split(';');
                this._mameIni[data[1]] = (value.length > 1) ? value : value[0];
            }

        });
        return true;
    }
}