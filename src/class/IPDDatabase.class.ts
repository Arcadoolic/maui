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

    public end() {
        if (this.db) {
            this.db.end();
        }
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
            // Filter hiscores on only know players
            hiscores = hiscores.filter((hiscore) => {
                return this.players.playerExist(hiscore.NAME);
            });
            if (!hiscores.length) {
                return resolve('No hiscores to save');
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
            this.db.query(query, (err) => {
                if (err) {
                    return reject(err);
                }
                return resolve();
            });
        });
    }

    public getAllTime(romName: string): Promise<Hiscores> {
        return new Promise((resolve, reject) => {
            if (!this.db) {
                return reject('No database connection');
            }
            const query = `SELECT
                score as SCORE,
                player_name as NAME
            FROM arcade.hiscores_history
            JOIN players ON player_name = initials AND is_active = 1
            WHERE id = '${romName}'
            GROUP BY SCORE,NAME
            ORDER BY CAST(SCORE AS DECIMAL) DESC
            LIMIT 100`;
            this.db.query(query, (err, results) => {
                if (err) {
                    return reject(err);
                }
                const hiscores: Hiscores = {classic: [[]], advanced: [[]]};
                for (let i = 0; i < results.length; i++) {
                    hiscores.classic[0].push({
                        RANK: i + 1,
                        SCORE: results[i].SCORE,
                        NAME: results[i].NAME,
                    });
                }
                return resolve(hiscores);
            });
        });
    }
}
