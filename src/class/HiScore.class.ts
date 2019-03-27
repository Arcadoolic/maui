import {execFile} from 'child_process';
import parse from 'csv-parse/lib/sync';
import {join} from 'path';
import Config from '@/class/Config.class';
import {writeFileSync} from 'fs';

export default class HiScore {
    protected config!: Config;

    public constructor(config: Config) {
        this.config = config;
    }

    /**
     * Get hiscores with hi2txt
     * @param romName
     */
    public getHiscore(romName: string): Promise<any[] | string> {
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
                    '-r',
                    '/home/tpayen/.mame/hi/' + romName + '.hi', // TODO : Replace by ui.ini config
                ],
                (error, stdout, stderr) => {
                    if (error) {
                        return reject(error);
                    }

                    return resolve(parse(stdout, {delimiter: '|', columns: true, skip_empty_lines: true}));
                });
        });
    }

    /**
     * Save hiscores in a json file
     * @param romName
     */
    public saveHiscore(romName: string): Promise<string> {
        return new Promise((resolve, reject) => {
            this.getHiscore(romName).then(
                (hiscores) => {
                    writeFileSync(join(this.config.hiscoresJsonPath, romName + '.json'), JSON.stringify(hiscores));
                    resolve('');
                },
                (error) => {
                    reject(error);
                },
            );
        });
    }
}
