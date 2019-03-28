import {execFile} from 'child_process';
import parse from 'csv-parse/lib/sync';
import {join} from 'path';
import Config from '@/class/Config.class';
import {writeFileSync, readFileSync} from 'fs';

export default class HiScore {
    protected config!: Config;

    public constructor(config: Config) {
        this.config = config;
    }

    /**
     * Get hiscores with hi2txt
     * @param romName
     */
    public getHiscore(romName: string): Promise<{ classic: any[], advanced: any[] } | string> {
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
                    '/home/tpayen/.mame/hi/' + romName + '.hi', // TODO : Replace by ui.ini config
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
                        hiscores = parse(hiscores, {delimiter: '|', columns: true, skip_empty_lines: true});
                        if (index) {
                            ret.advanced.push(hiscores);
                        } else {
                            ret.classic.push(hiscores);
                        }
                    });
                    return resolve(ret);
                });
        });
    }

    /**
     * Save hiscores in a json file
     * @param romName
     */
    public saveHiscore(romName: string): Promise<string|{classic: unknown[], advanced: unknown[]}> {
        return new Promise((resolve, reject) => {
            this.getHiscore(romName).then(
                (hiscores) => {
                    writeFileSync(join(this.config.hiscoresJsonPath, romName + '.json'), JSON.stringify(hiscores));
                    resolve(hiscores);
                },
                (error) => {
                    reject(error);
                },
            );
        });
    }

    public loadHiscore(romName: string): {classic: unknown[], advanced: unknown[]}|null {
        try {
            const hiscores = readFileSync(join(this.config.hiscoresJsonPath, romName + '.json'), 'utf8');
            return JSON.parse(hiscores);
        } catch (e) {
            return null;
        }
    }
}
