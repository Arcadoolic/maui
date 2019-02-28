import {execFile} from 'child_process';
import parse from 'csv-parse/lib/sync';
import {join} from 'path';

export default class HiScore {

    public getHiscore(): Promise<any[] | string> {
        return new Promise((resolve, reject) => {
            const hi2txtPath = join(process.env.NODE_ENV === 'development'
                ? './resources' : process.resourcesPath!, 'hi2txt');
            execFile('java',
                ['-jar', join(hi2txtPath, 'hi2txt.jar'), '-descr', join(hi2txtPath, 'hi2txt'), '-r', 'hi/asteroid.hi'],
                (error, stdout, stderr) => {
                    if (error) {
                        return reject(error);
                    }

                    return resolve(parse(stdout, {delimiter: '|', columns: true, skip_empty_lines: true}));
                });
        });
    }
}
