import {execFile, ChildProcess} from 'child_process';
import Game from '@/class/Game.class';
import {existsSync, readFileSync} from 'fs';
import * as os from 'os';
import {join} from 'path';

export default class Mame {
    protected mameConfig: { [key: string]: any } = {};
    protected mameUiConfig: { [key: string]: any } = {};

    protected process?: ChildProcess;

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
        let success = this.parseMameIniFile(mameIniPath, this.mameConfig);
        if (!success) {
            throw new Error('File missing or failed parsing ' + mameIniPath);
        }
        if (!this.mameConfig.inipath) {
            throw new Error('ui value is missing in mame.ini');
        }
        for (const inipath of  this.mameConfig.inipath) {
            success = this.parseMameIniFile(inipath + '/ui.ini', this.mameUiConfig);
            if (success) {
                this.mameConfig.usedInipath = inipath;
                break;
            }
        }
        if (!success) {
            throw new Error('File missing or failed parsing ui.ini');
        }
    }

    /**
     * Start a mame game, if a process is already on, kill it
     * @param game
     */
    public start(game: Game) {
        if (!game.romName) {
            return false;
        }

        this.stop().then(
            () => {
                this.process = execFile('/usr/games/mame', [game.romName!, '-nomax', '-w'], {killSignal: 'SIGQUIT'},
                    (error, stdout, stderr) => {
                        if (error) {
                            console.error(`exec error: ${error}`);
                            return;
                        }
                        console.log(`stdout: ${stdout}`);
                        console.log(`stderr: ${stderr}`);
                    });
                this.process.on('close', (e) => {
                    console.log('CLOSE');
                    this.process = undefined;
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
            this.process.on('exit', (e) => {
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
        filePath = filePath.replace('$HOME', os.homedir());
        if (!existsSync(filePath)) {
            return false;
        }
        const regex = new RegExp(/^([a-z_]+)\s+(.+)$/);
        const file = readFileSync(filePath, 'utf8').split('\n');
        file.forEach((line) => {
            if (line[0] === '#') { // Skip comments
                return true;
            }
            const data = regex.exec(line);
            if (data) {
                const value = data[2].replace(/^"(.*)"$/, '$1').split(';');
                TargetObject[data[1]] = (value.length > 1) ? value : value[0];
            }

        });
        return true;
    }

    /**
     * Return favorites from mame's favorites.ini
     */
    public getFavorites() {
        let favoritePath = join(
            this.mameConfig.usedInipath,
            this.mameUiConfig.ui_path.replace(/^.*\/(.*)$/, '$1'),
            'favorites.ini');
        favoritePath = favoritePath.replace('$HOME', os.homedir());
        const regexp = new RegExp(/^(?![0-9]*$)[a-z0-9]+$/, 'gm');
        const file = readFileSync(favoritePath, 'utf8').split('\n');
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
}
