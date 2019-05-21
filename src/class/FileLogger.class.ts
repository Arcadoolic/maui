import {appendFileSync} from 'fs';

export default class FileLogger {
    protected filePath!: string;

    constructor(filePath: string) {
        this.filePath = filePath;
    }

    /**
     * Log an error into log file
     * @param er
     */
    public logError(er: string) {
        appendFileSync(this.filePath, '[Error][' + Date.now() + ']' + er + '\n');
    }
}
