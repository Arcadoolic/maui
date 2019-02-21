import {exec} from 'child_process';
import parse from 'csv-parse/lib/sync';

export default class HiScore {

    public getHiscore(): Promise<void> {
        return new Promise((resolve, reject) => {
            exec('java -jar hi2txt.jar -r hi/asteroid.hi', (error, stdout, stderr) => {
                if (error) {
                    return reject(error);
                }

                return resolve(parse(stdout, { delimiter: '|', columns: true, skip_empty_lines: true }));
            });
        });
    }
}
