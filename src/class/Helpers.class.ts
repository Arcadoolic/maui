import * as os from 'os';
import {join, sep} from 'path';
import {existsSync, mkdirSync} from 'fs';

export default class Helpers {

    /**
     * Get first existing directory of a directory list
     * @param paths
     * @param parentPath
     * @param file
     */
    public static getFirstExistingDirectory(paths: string[], parentPath?: string|null, file?: string): string|null {
        for (let path of paths) {
            path = path.replace(/\$HOME|~/, os.homedir);
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

    /**
     * Dedicated, stable directory where mame is forced to read its ini files from and
     * write its own state (cfg, nvram, snapshots, ...), regardless of the app's cwd. A plain
     * ~/.mame, separate from ~/.mame-awesome-ui (this app's own config/database - see
     * Config.class.ts) since it belongs to mame itself, not to mame-awesome-ui.
     */
    public static getMameHomePath(): string {
        const homePath = join(os.homedir(), '.mame');
        if (!existsSync(homePath)) {
            mkdirSync(homePath, {recursive: true});
        }
        return homePath;
    }
}
