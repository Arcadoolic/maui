import {existsSync, readFileSync, writeFileSync} from 'fs';
import {join} from 'path';
import {ConnectionConfig} from 'mysql';
import {remote} from 'electron';
import {execFile} from 'child_process';

export default class Config {
    public mamePath: string = '';
    public mameBinaryName: string =  '';
    public avatarsPath: string = '';

    protected configPath!: string;
    protected _configLoaded: boolean = false;

    public constructor() {
        this.configPath = join(
            (process.env.NODE_ENV === 'development' ? '.' : remote.app.getPath('userData')),
            'mame-awesome-ui-config.json',
        );
    }

    public exist(): boolean {
        return existsSync(this.configPath);
    }

    public load(): boolean {
        if (existsSync(this.configPath)) {
            const configFile = JSON.parse(readFileSync(this.configPath, 'utf8'));

            this.mamePath = configFile.mamePath;
            this.mameBinaryName = configFile.mameBinaryName;
            this.avatarsPath = configFile.avatarsPath;

            this._configLoaded = true;
            return true;
        }
        return false;
    }

    public save() {
        const userData = remote.app.getPath('userData');
        writeFileSync(
            join(
                (process.env.NODE_ENV === 'development' ? '.' : userData),
                'mame-awesome-ui-config.json',
            ),
            JSON.stringify({
                mamePath: this.mamePath,
                mameBinaryName: this.mameBinaryName,
                avatarsPath: this.avatarsPath,
            }),
        );
    }

    public loaded() {
        return this._configLoaded;
    }
}
