import {readFileSync} from 'fs';
import {join} from 'path';
import Helpers from '@/class/Helpers.class';
import {execFileSync} from 'child_process';
import os from 'os';
import Config from '@/class/Config.class';

export default class MameService {
    protected config!: Config;
    protected iniPath!: string;
    protected mameIni: { [key: string]: any } = {} = {};
    protected uiIni: any = {};

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

    public getGameInformation(romName: string) {
        console.log('Game information ' + romName);
        console.log(this.mameBinary);
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
}
