import {existsSync, readdirSync} from 'fs';
import {extname, parse, join} from 'path';
import {format} from 'url';

export default class Players {
    protected faceyourmangaPath!: string;
    protected _players: {[playerName: string]: string} = {};

    public constructor(faceyourmangaPath: string) {
        this.faceyourmangaPath = faceyourmangaPath;
        this.init();
    }

    public init() {
        if (!existsSync(this.faceyourmangaPath)) {
            throw new Error(this.faceyourmangaPath + ' do not exist');
        }
        const files = readdirSync(this.faceyourmangaPath, 'utf8');
        for (const file of files) {
            if (extname(file).toLowerCase() !== '.png') {
                continue;
            }
            this._players[parse(file).name] = format({
                protocol: 'file',
                pathname: join(this.faceyourmangaPath, file),
                slashes: true,
            });
        }
    }

    public get players() {
        return this._players;
    }

    public playerExist(playerName: string) {
        return this._players[playerName] !== undefined;
    }

    public getPlayerIcon(playerName: string) {
        return this.playerExist(playerName) ? this._players[playerName] : null;
    }
}
