import Config from '@/class/Config.class';
import {createConnection, Connection} from 'mysql';
import Players from '@/class/Players.class';

export default class IPDDatabase {
    protected config!: Config;
    protected db?: Connection;
    protected players!: Players;

    public constructor(config: Config, players: Players) {
        this.config = config;
        this.players = players;
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
                if (!this.players.playerExist(hiscore.NAME)) {
                    continue;
                }
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
            this.db.query(query, (err) => {
                if (err) {
                    return reject(err);
                }
                return resolve();
            });
        });
    }

    public getAllTime(romName: string) {
        return new Promise((resolve, reject) => {
            if (!this.db) {
                return reject('No database connection');
            }
            const query = 'SELECT player_name as NAME, score * 1 as SCORE FROM hiscores_history ' +
                'WHERE id=\'asteroid\' GROUP BY player_name, score ORDER BY score DESC LIMIT 100';
            this.db.query(query, (err, results) => {
                if (err) {
                    return reject(err);
                }
                const hiscores: Hiscores = {classic: [], advanced: []};
                for (let i = 0; i < results.length; i++) {
                    hiscores.classic[0].push({
                        RANK: i + 1,
                        SCORE: results[i].SCORE,
                        NAME: results[i].NAME,
                    });
                }
                return resolve(results);
            });
        });
    }
}
