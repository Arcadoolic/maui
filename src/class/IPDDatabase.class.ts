import Config from '@/class/Config.class';
import {createConnection, Connection} from 'mysql';

export default class IPDDatabase {
    protected config!: Config;
    protected db?: Connection;

    public constructor(config: Config) {
        this.config = config;
    }

    public connect() {
        return new Promise((resolve, reject) => {
            this.db = createConnection(this.config.db);
            this.db.connect((err) => {
                if (err) {
                    return reject(err);
                }
                return resolve();
            });
        });
    }

    public logGameStart(romName: string) {
        return new Promise((resolve, reject) => {
            if (!this.db) {
                return reject('No database connection');
            }
            const query = 'INSERT INTO games_history (rom) VALUES (?)';
            this.db.query(query, romName, (err) => {
                if (err) {
                    return reject(err);
                }
                return resolve();
            });
        });
    }

    public saveHiscores(romName: string, hiscores: Hiscore[]) {
        return new Promise((resolve, reject) => {
            if (!this.db) {
                return reject('No database connection');
            }
            if (!hiscores.length) {
                return reject('No hiscores to save');
            }
            let query = 'INSERT IGNORE INTO hiscores_history (id, rank, player_name, score) VALUES';
            for (const hiscore of hiscores) {
                query = query.concat(
                    ' ("',
                    romName,
                    '", ',
                    hiscore.RANK.toString(),
                    ',"',
                    hiscore.NAME,
                    '",',
                    hiscore.SCORE.toString(),
                    '),',
                );
            }
            query = query.slice(0, -1);
            console.log(query);
            this.db.query(query, (err) => {
                if (err) {
                    return reject(err);
                }
                return resolve();
            });
        });
    }
}
