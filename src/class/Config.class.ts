import {existsSync, readFileSync} from 'fs';
import {ConnectionConfig} from 'mysql';

export default class Config {
    protected _defaultMameIni: string = '/etc/mame/mame.ini';
    protected _defaultGamesJsonPath: string = './games';
    protected _defaultHiscoresJsonPath: string = './hiscores';
    protected _defaultFaceyourmangaPath: string = './faceyourmanga';
    protected _defaultDb: ConnectionConfig = {host: 'localhost', user: 'root', password: '', database: 'mame'};

    protected _configLoaded: boolean = false;
    protected _mameIniPath?: string;
    protected _gamesJsonPath?: string;
    protected _hiscoresJsonPath?: string;
    protected _faceyourmangaPath?: string;
    protected _db?: ConnectionConfig;

    public load(): boolean {
        if (existsSync('./config.json')) {
            const configFile = JSON.parse(readFileSync('./config.json', 'utf8'));
            this._mameIniPath = configFile.mameIniPath;
            this._gamesJsonPath = configFile.gamesJsonPath;
            this._hiscoresJsonPath = configFile.hiscoresJsonPath;
            this._faceyourmangaPath = configFile.faceyourmangaPath;
            this._db = configFile.db;
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
        return this._mameIniPath || this._defaultMameIni;
    }

    /**
     * @return string
     */
    public get gamesJsonPath(): string {
        return this._gamesJsonPath || this._defaultGamesJsonPath;
    }

    /**
     * @return string
     */
    public get hiscoresJsonPath(): string {
        return this._hiscoresJsonPath || this._defaultHiscoresJsonPath;
    }

    /**
     * @return string
     */
    public get faceyourmangaPath(): string {
        return this._faceyourmangaPath || this._defaultFaceyourmangaPath;
    }

    public get db(): ConnectionConfig {
        return this._db || this._defaultDb;
    }
}
