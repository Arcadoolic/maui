import {execFile} from 'child_process';
import parse from 'csv-parse/lib/sync';
import {join} from 'path';
import Config from '@/class/Config.class';
import {writeFileSync, readFileSync} from 'fs';

export default class HiscoreService {
    protected config!: Config;
    protected hiPath!: string;

    public constructor(config: Config, hiPath: string) {
        this.config = config;
        this.hiPath = hiPath;
    }

    /**
     * Get hiscores with hi2txt
     * @param romName
     */
    public getHiscore(romName: string): Promise<Hiscores> {
        return new Promise((resolve, reject) => {
            const hi2txtPath = join(process.env.NODE_ENV === 'development'
                ? './resources' : process.resourcesPath!, 'hi2txt');
            execFile(
                'java',
                [
                    '-jar',
                    join(hi2txtPath, 'hi2txt.jar'),
                    '-descr',
                    join(hi2txtPath, 'hi2txt'),
                    '-ra',
                    join(this.hiPath, 'hi', romName + '.hi'),
                ],
                (error, stdout, stderr) => {
                    if (error) {
                        return reject(error);
                    }

                    const splitedStdout = stdout.split(/\n{2,}/);
                    const ret = {classic: [] as any[], advanced: [] as any[]};
                    splitedStdout.forEach((hiscores: string, index) => {
                        if (hiscores.trim() === '') {
                            return true;
                        }
                        const hiscoresObj = parse(hiscores, {delimiter: '|', columns: true, skip_empty_lines: true});
                        hiscoresObj.NAME = hiscoresObj.NAME.trim();
                        if (index) {
                            ret.advanced.push(hiscoresObj);
                        } else {
                            ret.classic.push(hiscoresObj);
                        }
                    });
                    return resolve(ret);
                });
        });
    }

    /**
     * Save hiscores in a json file
     * @param romName
     * @param hiscores
     */
    public saveHiscore(romName: string, hiscoresJson: HiscoresJson): void {
        writeFileSync(join(this.config.hiscoresJsonPath, romName + '.json'), JSON.stringify(hiscoresJson));
    }

    /**
     *
     * @param romName
     */
    public loadHiscore(romName: string): HiscoresJson|null {
        try {
            const hiscores = readFileSync(join(this.config.hiscoresJsonPath, romName + '.json'), 'utf8');
            return JSON.parse(hiscores);
        } catch (e) {
            return null;
        }
    }
}
