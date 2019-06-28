import {execFile, ChildProcess} from 'child_process';
import Game from '@/class/Game.class';
import {existsSync, readFileSync} from 'fs';
import * as os from 'os';
import {join} from 'path';
import {execSync} from 'child_process';
import Helpers from '@/class/Helpers.class';

export default class Mame {
    protected process?: ChildProcess;

    protected _mameConfig: { [key: string]: any } = {};

    public get mameConfig() {
        return this._mameConfig;
    }

    protected _mameUiConfig: { [key: string]: any } = {};

    public get mameUiConfig() {
        return this._mameUiConfig;
    }

    protected _mameUiPath: string = '';

    public get mameUiPath() {
        return this._mameUiPath;
    }

    /**
     * @return boolean
     */
    public get isGameOn() {
        return this.process;
    }

    /**
     * Init mame class
     * @param mameIniPath
     */
    public init(mameIniPath: string) {
        if (!this.parseMameIniFile(mameIniPath, this.mameConfig)) {
            throw new Error('File missing or failed parsing ' + mameIniPath);
        }
        if (!this.mameConfig.inipath) {
            throw new Error('ui value is missing in mame.ini');
        }
        const uipath = Helpers.getFirstExistingDirectory(this.mameConfig.inipath, null);
        if (!uipath) {
            throw new Error('File missing or failed parsing ui.ini');
        }
        this._mameUiPath = uipath;
        this.parseMameIniFile(join(uipath, 'ui.ini'), this.mameUiConfig);
    }

    /**
     * Start a mame game, if a process is already on, kill it
     * @param game
     */
    public start(game: Game): Promise<ChildProcess | void> {
        return new Promise((resolve, reject) => {
            if (!game.romName) {
                return reject();
            }

            this.stop().then(
                () => {
                    this.process = execFile('mame', [game.romName!], {
                            killSignal: 'SIGQUIT',
                            cwd: this.mameUiPath,
                        },
                        (error, stdout, stderr) => {
                            if (error) {
                                console.error(`exec error: ${error}`);
                                return;
                            }
                            console.log(`stdout: ${stdout}`);
                            console.log(`stderr: ${stderr}`);
                        });
                    this.process.on('close', (e) => {
                        this.process = undefined;
                    });
                    resolve(this.process);
                });
        });
    }

    /**
     * Stop mame process
     */
    public stop(): Promise<void> {
        return new Promise((resolve, reject) => {
            if (!this.process) {
                return resolve();
            }
            this.process.kill('SIGQUIT');
            this.process.on('close', (e) => {
                return resolve();
            });
        });
    }

    /**
     * Parse a mame ini file
     * @param filePath
     * @param TargetObject
     */
    public parseMameIniFile(filePath: string, TargetObject: { [key: string]: any }) {
        const regex = new RegExp(/^([a-z_]+)\s+(.+)$/);
        const file = readFileSync(filePath, 'utf8').split('\n');
        file.forEach((line) => {
            if (line[0] === '#') { // Skip comments
                return true;
            }
            const data = regex.exec(line);
            if (data) {
                TargetObject[data[1]] = data[2].replace(/^"(.*)"$/, '$1').split(';');
            }
        });
        return true;
    }

    /**
     * Return favorites from mame's favorites.ini
     */
    public getFavorites() {
        const favoritePath = Helpers.getFirstExistingDirectory(
            this.mameUiConfig.ui_path,
            this.mameUiPath,
            'favorites.ini',
        );
        if (!favoritePath) {
            throw new Error('Unable to read or parse favorites.ini - ' + favoritePath);
        }
        const regexp = new RegExp(/^(?![0-9]$)[a-z0-9]+$/, 'gm');
        const file = readFileSync(favoritePath!, 'utf8').split('\n');
        const retArray: string[] = [];
        const existing: { [key: string]: boolean } = {};
        file.forEach((line: string) => {
            if (regexp.test(line) && !existing[line]) {
                existing[line] = true;
                retArray.push(line);
            }
        });
        return retArray;
    }

    /**
     * Check if a rom is valid with mame -verifyroms [romname]
     * @param romName
     */
    public isRomValid(romName: string) {
        try {
            execSync('mame -verifyroms ' + romName, {encoding: 'utf8'});
            return true;
        } catch (e) {
            return false;
        }
    }

    /**
     * Get game information from mame xml created with -listxml command
     * @param romName
     */
    public getGameInfoFromMameXML(romName: string) {
        try {
            const parser = new DOMParser();
            const xml = parser.parseFromString(execSync('mame -lx ' + romName, {encoding: 'utf8'}), 'text/xml');
            return {
                manufacturer: xml.getElementsByTagName('manufacturer')[0].innerHTML,
                year: parseInt(xml.getElementsByTagName('year')[0].innerHTML, 10),
                description: xml.getElementsByTagName('description')[0].innerHTML,
            };
        } catch (e) {
            console.log('error');
        }
    }

    public getRomParent(romName: string) {
        let cmdRet = '';
        try {
            cmdRet = execSync('mame -lc ' + romName + ' | grep \'^' + romName + '\'', {encoding: 'utf8'});
        } catch (e) {
            return '';
        }
        if (!cmdRet) {
            return '';
        }
        const cmdRetSplit = cmdRet.split(/\s+/);
        if (cmdRetSplit && cmdRetSplit[1]) {
            return cmdRetSplit[1];
        }
        return null;
    }
}
