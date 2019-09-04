import {existsSync} from 'fs';
import {join, basename} from 'path';
import {remote} from 'electron';
import {Sequelize} from 'sequelize-typescript';
import Category from '@/model/Category.model';
import GameService from '@/class/GameService.class';
import Game from '@/model/Game.model';
import User from '@/model/User.model';
import Hiscore from '@/model/Hiscore.model';
import Umzug from 'umzug';
import * as Log from 'electron-log';

export default class Database {
    protected databasePath!: string;
    protected _sequelize!: Sequelize;

    public constructor() {
        this.databasePath = join(
            (process.env.NODE_ENV === 'development' ? '.' : remote.app.getPath('userData')),
            'mame-awesome-ui.sqlite',
        );
        this._sequelize = new Sequelize({
            dialect: 'sqlite',
            storage: this.databasePath,
            models: [Category, Game, User, Hiscore],
            logging: false,
        });
    }

    public exist() {
        return existsSync(this.databasePath);
    }

    public async install(gameService: GameService) {
        await this.sequelize.sync();

        const records: Array<{id_category: number, name: string}> = [];
        const categories = Object.keys(gameService.getGameCategories());
        for (let i = 0; i < categories.length; i++) {
            records.push({id_category: i + 1, name: categories[i]});
        }
        // Create categories
        await Category.bulkCreate(records);
    }

    public get sequelize(): Sequelize {
        return this._sequelize;
    }

    /**
     * Perform all migrations and seeds
     */
    public async update() {
        return new Promise((resolve, reject) => {
            const umzug = new Umzug({
                storage: 'sequelize',
                storageOptions: {
                    sequelize: this.sequelize
                },
                migrations: {
                    params: [
                        this.sequelize.getQueryInterface(),
                        Sequelize,
                        function() {
                            throw new Error('Migration tried to use old style "done" callback.');
                        }
                    ],
                    path: './migrations',
                    pattern: /\.js$/,
                    customResolver(path: string): { up: () => PromiseLike<any>; down?: () => PromiseLike<any> } {
                        return require('../../migrations/' + basename(path, '.js'));
                    }
                }
            });

            umzug.up().then((migrations) => {
                for (let migration of migrations) {
                    Log.log('[Database] Migration "' + migration.file + "' success.");
                }
                resolve();
            })
            .catch((error) => {
                Log.error('[Migration] Error on migration.');
                Log.error(error);
                reject(error);
            });
        })
    }
}
