import {existsSync, readFileSync, writeFileSync} from 'fs';
import {join} from 'path';

export default class Config {
    public mamePath: string = '';
    public mameBinaryName: string =  '';
    public avatarsPath: string = '';

    // ScreenScraper API (screenscraper.fr) credentials, used to fetch marquees/artworks.
    public ssDevId: string = '';
    public ssDevPassword: string = '';
    public ssSoftName: string = '';
    public ssUserId: string = '';
    public ssUserPassword: string = '';

    protected configPath!: string;
    protected _configLoaded: boolean = false;

    protected userDataPath!: string;

    public constructor(userDataPath: string) {
        this.userDataPath = userDataPath;
        this.configPath = join(
            (process.env.NODE_ENV === 'development' ? '.' : userDataPath), 'mame-awesome-ui-config.json',
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

            this.ssDevId = configFile.ssDevId || '';
            this.ssDevPassword = configFile.ssDevPassword || '';
            this.ssSoftName = configFile.ssSoftName || '';
            this.ssUserId = configFile.ssUserId || '';
            this.ssUserPassword = configFile.ssUserPassword || '';

            this._configLoaded = true;
            return true;
        }
        return false;
    }

    public save() {
        const userData = this.userDataPath;
        writeFileSync(
            join(
                (process.env.NODE_ENV === 'development' ? '.' : userData),
                'mame-awesome-ui-config.json',
            ),
            JSON.stringify({
                mamePath: this.mamePath,
                mameBinaryName: this.mameBinaryName,
                avatarsPath: this.avatarsPath,
                ssDevId: this.ssDevId,
                ssDevPassword: this.ssDevPassword,
                ssSoftName: this.ssSoftName,
                ssUserId: this.ssUserId,
                ssUserPassword: this.ssUserPassword,
            }),
        );
    }

    public loaded() {
        return this._configLoaded;
    }
}
