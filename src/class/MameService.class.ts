import {readFileSync} from 'fs';
import {join} from 'path';
import Helpers from '@/class/Helpers.class';
import Config from '@/class/Config.class';
import {execFileSync, ChildProcess, execFile} from 'child_process';

export default class MameService {
    public mameIni: { [key: string]: any } = {} = {};
    public uiIni: any = {};
    public iniPath!: string;

    protected config!: Config;

    protected gameProcess: ChildProcess|null = null;

    /**
     * Load and parse mame.ini and ui.ini file
     * @param config
     * @throws
     */
    public constructor(config: Config) {
        this.config = config;
        const mameIniContent = execFileSync(this.mameBinary, ['-showconfig']);
        if (!MameService.parseMameIniFile(mameIniContent.toString(), this.mameIni)) {
            throw new Error('File missing or failed parsing ' + join(this.config.mamePath, 'mame.ini'));
        }
        if (!this.mameIni.inipath) {
            throw new Error('ui value is missing in mame.ini');
        }
        const iniPath = Helpers.getFirstExistingDirectory(this.mameIni.inipath, this.config.mamePath) || '';
        if (!iniPath) {
            throw new Error('File missing or failed parsing ui.ini');
        }
        this.iniPath = iniPath;
        const uiIniContent = readFileSync(join(this.iniPath, 'ui.ini'), 'utf8');
        if (!MameService.parseMameIniFile(uiIniContent, this.uiIni)) {
            throw new Error('File missing or failed parsing ' + join(this.iniPath, 'ui.ini'));
        }
    }

    public get mameBinary() {
        return join(this.config.mamePath, this.config.mameBinaryName);
    }

    /**
     * Parse a mame ini file
     * @param fileContent
     * @param TargetObject
     */
    protected static parseMameIniFile(fileContent: string, TargetObject: { [key: string]: any }) {
        const regex = new RegExp(/^([a-z_]+)\s+(.+)$/);
        const file = fileContent.split('\n');
        file.forEach((line) => {
            if (line[0] === '#') { // Skip comments
                return true;
            }
            const data = regex.exec(line.trim());
            if (data) {
                TargetObject[data[1]] = data[2].replace(/^"(.*)"$/, '$1').split(';');
            }
        });
        return true;
    }

    /**
     * Read, parse and extract romNames from mame favorites.ini file
     */
    public getRomListFromFavorites() {
        const favoritePath = Helpers.getFirstExistingDirectory(
            this.uiIni.ui_path,
            this.iniPath,
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
            line = line.trim(); // FIXME : Do not take first favorite !
            if (regexp.test(line) && !existing[line]) {
                existing[line] = true;
                retArray.push(line);
            }
        });
        return retArray;
    }

    /**
     * Exec mame with param -lx to get game informations in XML
     * @param romName
     */
    public getGameInformation(romName: string) {
        const parser = new DOMParser();
        const xml = parser.parseFromString(
            execFileSync(this.mameBinary, ['-lx', romName], {encoding: 'utf8'}),
            'text/xml',
        );
        return {
            manufacturer: xml.getElementsByTagName('manufacturer')[0].innerHTML,
            year: parseInt(xml.getElementsByTagName('year')[0].innerHTML, 10),
            description: xml.getElementsByTagName('description')[0].innerHTML,
        };
    }

    /**
     * Return marquee path
     */
    public get marqueePath() {
        return Helpers.getFirstExistingDirectory(
            this.uiIni.marquees_directory,
            this.iniPath,
        );
    }

    /**
     * Return flyer path
     */
    public get flyerPath() {
        return Helpers.getFirstExistingDirectory(
            this.uiIni.flyers_directory,
            this.iniPath,
        );
    }

    /**
     * Start game on mame
     * @param romName
     */
    public startGame(romName: string): Promise<ChildProcess> {
        return new Promise(async (resolve, reject) => {
            await this.stopGame();
            this.gameProcess = execFile(this.mameBinary, ['-skip_gameinfo', '-w', romName], {
                killSignal: 'SIGQUIT',
                cwd: this.iniPath,
            }, (error, stdout, stderr) => {
                if (error) {
                    return reject();
                }
            });
            this.gameProcess.on('close', (e) => {
                this.gameProcess = null;
            });
            resolve(this.gameProcess);
        });
    }

    /**
     * Quit mame process
     */
    public async stopGame(): Promise<void> {
        return new Promise((resolve, reject) => {
            console.log(this.gameProcess);
            if (!this.gameProcess) {
                return resolve();
            }
            this.gameProcess.kill('SIGQUIT');
            this.gameProcess.on('close', (e) => {
                return resolve();
            });
        });
    }

    /**
     *  Check if mame process is started
     */
    public get isGameStarted(): boolean {
        return (this.gameProcess !== null && this.gameProcess.pid !== 0 && !this.gameProcess.killed);
    }
}
