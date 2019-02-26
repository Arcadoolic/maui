import {execFile, ChildProcess} from 'child_process';
import Game from '@/class/Game.class';
import {existsSync, readFileSync} from 'fs';
import * as os from 'os';

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
        const uiIniPath = (this.mameConfig.inipath.length > 1 ? this.mameConfig.inipath[0] : this.mameConfig.inipath)
            + '/ui.ini';
        success = this.parseMameIniFile(uiIniPath, this.mameUiConfig);
        if (!success) {
            throw new Error('File missing or failed parsing ' + uiIniPath);
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
                const value = data[2].split(';');
                TargetObject[data[1]] = (value.length > 1) ? value : value[0];
            }

        });
        return true;
    }
}
