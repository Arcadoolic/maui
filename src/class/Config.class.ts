import {existsSync, readFileSync} from 'fs';

export default class Config {
    protected _defaultMameIni: string = '/etc/mame/mame.ini';
    protected _defaultGamesJsonPath: string = './games';

    protected _configLoaded: boolean = false;
    protected _mameIniPath?: string;
    protected _gamesJsonPath?: string;

    public load(): boolean {
        if (existsSync('./config.json')) {
            const configFile = JSON.parse(readFileSync('./config.json', 'utf8'));
            this._mameIniPath = configFile.mameIniPath;
            this._gamesJsonPath = configFile.gamesJsonPath;
            this._configLoaded = true;
            return true;
        }
        return false;
    }

    public save() {
        // Ici on ecrit le ficher de config
    }

    /**
     * @return string
     */
    public get mameIniPath(): string {
        return this._mameIniPath!;
    }

    public get gamesJsonPath(): string {
        return this._gamesJsonPath || this._defaultGamesJsonPath;
    }
}
