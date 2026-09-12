import {existsSync, readFileSync} from 'fs';
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
        // Force mame to read/write everything (ini files, cfg, nvram, snapshots, ...) from a
        // dedicated, stable directory instead of wherever it happens to be launched from.
        this.iniPath = Helpers.getMameHomePath();

        const uiIniPath = join(this.iniPath, 'ui.ini');
        if (!existsSync(uiIniPath)) {
            // -createconfig always writes mame.ini/ui.ini next to cwd, ignoring -inipath/-homepath,
            // so bootstrap the dedicated home directory by running it from there.
            execFileSync(this.mameBinary, ['-createconfig'], {cwd: this.iniPath});
        }
        if (!existsSync(uiIniPath)) {
            throw new Error('File missing or failed parsing ' + uiIniPath);
        }

        const mameIniContent = execFileSync(
            this.mameBinary,
            ['-showconfig', ...this.mameHomeArgs],
            {cwd: this.iniPath},
        );
        MameService.parseMameIniFile(mameIniContent.toString(), this.mameIni);

        const uiIniContent = readFileSync(uiIniPath, 'utf8');
        MameService.parseMameIniFile(uiIniContent, this.uiIni);
    }

    public get mameBinary() {
        return join(this.config.mamePath, this.config.mameBinaryName);
    }

    /**
     * CLI args forcing mame to use the dedicated home directory for both ini lookup
     * and everything it would otherwise write relative to its own cwd.
     */
    protected get mameHomeArgs(): string[] {
        return ['-inipath', this.iniPath, '-homepath', this.iniPath];
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
            // No favorites.ini yet (e.g. fresh MAME install, no favorite added) - treat as empty list
            return [];
        }
        // No 'g' flag: a global regexp's .test() keeps lastIndex state between calls, which
        // silently skips every other line when reused across forEach iterations like this.
        const regexp = /^(?![0-9]$)[a-z0-9]+$/;
        const file = readFileSync(favoritePath!, 'utf8').split('\n');
        const retArray: string[] = [];
        const existing: { [key: string]: boolean } = {};
        file.forEach((line: string) => {
            line = line.trim();
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
        const xmlContent = execFileSync(
            this.mameBinary,
            ['-lx', romName, ...this.mameHomeArgs],
            {encoding: 'utf8', cwd: this.iniPath},
        );
        const xml = parser.parseFromString(xmlContent, 'text/xml');
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
     * Return logo ("wheel" art) path
     */
    public get logoPath() {
        return Helpers.getFirstExistingDirectory(
            this.uiIni.logos_directory,
            this.iniPath,
        );
    }

    /**
     * Path to genre.ini inside ui.ini's categorypath directory - the game categorization
     * dataset matching the installed mame version. Unlike marquees/flyers/logos, which may
     * legitimately not exist yet, genre.ini is guaranteed present: every starting pack bundles
     * and (re)installs its own copy on import (see boServer.ts's importStartingPack()), so
     * callers don't need to handle it being missing.
     */
    public get genreIniPath() {
        return Helpers.getFirstExistingDirectory(
            this.uiIni.categorypath,
            this.iniPath,
            'genre.ini',
        );
    }

    /**
     * Path to Multiplayer.ini inside ui.ini's categorypath directory - the game player-count
     * dataset matching the installed mame version. Same guarantee as genreIniPath: every
     * starting pack bundles and (re)installs its own copy on import, so callers don't need to
     * handle it being missing.
     */
    public get nplayersIniPath() {
        return Helpers.getFirstExistingDirectory(
            this.uiIni.categorypath,
            this.iniPath,
            'Multiplayer.ini',
        );
    }

    /**
     * Start game on mame
     * @param romName
     */
    public startGame(romName: string): Promise<ChildProcess> {
        return new Promise(async (resolve, reject) => {
            await this.stopGame();
            this.gameProcess = execFile(this.mameBinary, ['-skip_gameinfo', romName, ...this.mameHomeArgs], {
                killSignal: 'SIGQUIT',
                cwd: this.iniPath,
            }, (error, stdout, stderr) => {
                if (error) {
                    return reject(error);
                }

                if (stderr) {
                    return reject(stderr);
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
