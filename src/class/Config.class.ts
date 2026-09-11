import {existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync} from 'fs';
import {join} from 'path';
import * as os from 'os';

// This app's own state directory - separate from ~/.mame (see Helpers.getMameHomePath()),
// which belongs to mame itself, not to mame-awesome-ui. Config/DB live here rather than under
// NODE_ENV-dependent locations (Electron's userData in production, the repo root in dev):
// there's no upside to splitting an app's own state across two different places depending on
// how it's run, and using the same fixed path in dev and production keeps behavior identical
// between the two instead of only exercising the production path once packaged.
function getAppDataPath(): string {
    const path = join(os.homedir(), '.mame-awesome-ui');
    if (!existsSync(path)) {
        mkdirSync(path, {recursive: true});
    }
    return path;
}

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

    // Whether to auto-open Chromium DevTools on startup, in dev mode (electron:serve). Defaults
    // to false - opt in explicitly, either via the BO config form or by editing the config file.
    public openDevTools: boolean = false;

    public configPath!: string;
    protected _configLoaded: boolean = false;

    public constructor() {
        this.configPath = join(getAppDataPath(), 'mame-awesome-ui-config.json');
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

            this.openDevTools = configFile.openDevTools === true;

            this._configLoaded = true;
            return true;
        }
        return false;
    }

    public save() {
        writeFileSync(
            this.configPath,
            JSON.stringify({
                mamePath: this.mamePath,
                mameBinaryName: this.mameBinaryName,
                avatarsPath: this.avatarsPath,
                ssDevId: this.ssDevId,
                ssDevPassword: this.ssDevPassword,
                ssSoftName: this.ssSoftName,
                ssUserId: this.ssUserId,
                ssUserPassword: this.ssUserPassword,
                openDevTools: this.openDevTools,
            }),
        );
    }

    public loaded() {
        return this._configLoaded;
    }

    /**
     * Delete the config file, if any, so the app falls back to first-run setup.
     */
    public delete(): void {
        if (existsSync(this.configPath)) {
            unlinkSync(this.configPath);
        }
        this._configLoaded = false;
    }
}
