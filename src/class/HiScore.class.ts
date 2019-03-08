import {execFile} from 'child_process';
import parse from 'csv-parse/lib/sync';
import {join} from 'path';
import Game from '@/class/Game.class';

export default class HiScore {

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
                    '/home/tpayen/.mame/hi/' + romName + '.hi',
                ],
                (error, stdout, stderr) => {
                    if (error) {
                        return reject(error);
                    }

                    return resolve(parse(stdout, {delimiter: '|', columns: true, skip_empty_lines: true}));
                });
        });
    }
}
