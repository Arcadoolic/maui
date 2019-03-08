import * as os from 'os';
import {join, sep} from 'path';
import {existsSync} from 'fs';

export default class Helpers {

    /**
     * Get first existing directory of a directory list
     * @param paths
     * @param parentPath
     * @param file
     */
    public static getFirstExistingDirectory(paths: string[], parentPath?: string|null, file?: string): string|null {
        for (let path of paths) {
            path = path.replace('$HOME', os.homedir);
            if (path[0] !== '/' && parentPath) {
                parentPath = parentPath.replace('$HOME', os.homedir);
                const parentPathArray = parentPath.split(sep);
                const pathArray = path.split(sep);
                if (parentPathArray[parentPathArray.length - 1] === pathArray[0]) {
                    pathArray.shift();
                    path = pathArray.join(sep);
                }
                path = join(parentPath, path);
            }

            if (file) {
                path = join(path, file);
            }

            if (existsSync(path)) {
                return path;
            }
        }
        return null;
    }
}
