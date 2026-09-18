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

// User avatars used to live wherever the BO's setup form pointed avatarsPath at, requiring it
// to be browsed to and created by hand before it could be used. Fixed under the app's own data
// directory instead, created eagerly like getAppDataPath() itself, so it always exists with
// zero setup.
function getAvatarsPath(): string {
    const path = join(getAppDataPath(), 'avatars');
    if (!existsSync(path)) {
        mkdirSync(path, {recursive: true});
    }
    return path;
}

export default class Config {
    public mamePath: string = '';
    public mameBinaryName: string =  '';
    public readonly avatarsPath: string = getAvatarsPath();

    // ScreenScraper API (screenscraper.fr) credentials, used to fetch marquees/artworks.
    public ssDevId: string = '';
    public ssDevPassword: string = '';
    public ssSoftName: string = '';
    public ssUserId: string = '';
    public ssUserPassword: string = '';

    // Starting-pack repository (repo.maui.afronob.com or equivalent) - basic-auth credentials
    // used both to browse its index.json from the BO and to download a pack via
    // scripts/import-starting-pack.py --url.
    public repoUrl: string = '';
    public repoUser: string = '';
    public repoPassword: string = '';

    // GitHub PAT used only by BO admins to list/download PR-validation build artifacts (see the
    // "Mise à jour" tab's builds-de-PR section) - the public releases list needs no auth, but
    // the GitHub Actions artifacts API requires one even on a public repo.
    public githubToken: string = '';

    // Preferred bezel aspect ratio when fetching bezel artwork from ScreenScraper - 16:9 default
    // since new cabinet builds mostly use widescreen LCD monitors rather than 4:3 CRTs.
    public bezelAspect: '4:3' | '16:9' = '16:9';

    // Whether to auto-open Chromium DevTools on startup, in dev mode (electron:serve). Defaults
    // to false - opt in explicitly, either via the BO config form or by editing the config file.
    public openDevTools: boolean = false;

    // Whether Home.vue puts the window in full screen once launched - dev and production alike,
    // the BO setting is authoritative either way. Defaults to true: a cabinet's own display is
    // the main use case.
    public fullscreen: boolean = true;

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

            this.ssDevId = configFile.ssDevId || '';
            this.ssDevPassword = configFile.ssDevPassword || '';
            this.ssSoftName = configFile.ssSoftName || '';
            this.ssUserId = configFile.ssUserId || '';
            this.ssUserPassword = configFile.ssUserPassword || '';

            this.repoUrl = configFile.repoUrl || '';
            this.repoUser = configFile.repoUser || '';
            this.repoPassword = configFile.repoPassword || '';

            this.githubToken = configFile.githubToken || '';

            this.bezelAspect = configFile.bezelAspect === '4:3' ? '4:3' : '16:9';

            this.openDevTools = configFile.openDevTools === true;
            this.fullscreen = configFile.fullscreen !== false;

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
                ssDevId: this.ssDevId,
                ssDevPassword: this.ssDevPassword,
                ssSoftName: this.ssSoftName,
                ssUserId: this.ssUserId,
                ssUserPassword: this.ssUserPassword,
                repoUrl: this.repoUrl,
                repoUser: this.repoUser,
                repoPassword: this.repoPassword,
                githubToken: this.githubToken,
                bezelAspect: this.bezelAspect,
                openDevTools: this.openDevTools,
                fullscreen: this.fullscreen,
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
