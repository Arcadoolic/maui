import {existsSync, readFileSync, writeFileSync} from 'fs';
import {join} from 'path';
import {ConnectionConfig} from 'mysql';
import {remote} from 'electron';
import {execFile} from 'child_process';

export default class Config {
    protected configPath!: string;
    protected _configLoaded: boolean = false;

    protected _mamePath: string = '';
    protected _mameBinaryName: string =  '';

    protected _defaultGamesJsonPath: string = './games';
    protected _defaultHiscoresJsonPath: string = './hiscores';
    protected _defaultFaceyourmangaPath: string = './faceyourmanga';
    protected _defaultDb: ConnectionConfig = {host: 'localhost', user: 'root', password: '', database: 'mame'};

    protected _mameIniPath?: string;
    protected _gamesJsonPath?: string;
    protected _hiscoresJsonPath?: string;
    protected _faceyourmangaPath?: string;
    protected _db?: ConnectionConfig;

    public constructor() {
        this.configPath = join(
            (process.env.NODE_ENV === "development" ? '.' : remote.app.getPath('userData')),
            'mame-awesome-ui-config.json',
        );
    }

    public exist(): boolean {
        return existsSync(this.configPath);
    }

    public load(): boolean {
        if (existsSync(this.configPath)) {
            const configFile = JSON.parse(readFileSync(this.configPath, 'utf8'));

            this._mamePath = configFile.mamePath;
            this._mameBinaryName = configFile.mameBinaryName;

            // this._mameIniPath = configFile.mameIniPath;
            // this._gamesJsonPath = configFile.gamesJsonPath;
            // this._hiscoresJsonPath = configFile.hiscoresJsonPath;
            // this._faceyourmangaPath = configFile.faceyourmangaPath;
            // this._db = configFile.db;
            this._configLoaded = true;
            return true;
        }
        return false;
    }

    public save() {
        const userData = remote.app.getPath('userData');
        writeFileSync(
            join(
                (process.env.NODE_ENV === "development" ? '.' : userData),
                'mame-awesome-ui-config.json',
            ),
            JSON.stringify({
                mamePath: this._mamePath,
                mameBinaryName: this._mameBinaryName,
            }),
        );
    }

    public loaded() {
        return this._configLoaded;
    }

    public get mamePath(): string {
        return this._mamePath;
    }
    public set mamePath(val: string) {
        this._mamePath = val;
    }

    public get mameBinaryName(): string {
        return this._mameBinaryName;
    }
    public set mameBinaryName(val: string) {
        this._mameBinaryName = val;
    }

    /**
     * @return string
     */
    public get mameIniPath(): string|undefined {
        return this._mameIniPath;
    }

    public set mameIniPath(val: string|undefined) {
        this._mameIniPath = val;
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
