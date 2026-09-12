import {existsSync, mkdirSync} from 'fs';
import {join, basename} from 'path';
import * as os from 'os';
import * as SequelizeTS from 'sequelize-typescript';
const Sequelize = SequelizeTS.Sequelize;
type Sequelize = SequelizeTS.Sequelize;
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
        // Same fixed <home>/.mame-awesome-ui directory Config.class.ts uses (see its
        // getAppDataPath() comment) - kept identical in dev and production instead of an
        // NODE_ENV-dependent location.
        const appDataPath = join(os.homedir(), '.mame-awesome-ui');
        if (!existsSync(appDataPath)) {
            mkdirSync(appDataPath, {recursive: true});
        }
        this.databasePath = join(appDataPath, 'mame-awesome-ui.sqlite');
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

    public async install() {
        await this.sequelize.sync();
    }

    /**
     * (Re)seeds the category table from genre.ini (see GameService.getGameCategories()), which
     * is only ever installed by a starting pack import (see boServer.ts's importStartingPack())
     * and is optional - possibly added (or replaced by a newer pack) well after the database
     * already exists. Idempotent (upserts by the same positional id_category
     * GameService.getGameCategoryId() derives games' id_category from) so it's safe - and
     * necessary - to call on every launch, not just Database.install()'s first-ever run:
     * otherwise a game synced with an id_category genre.ini now maps to, but that was never
     * seeded into this table, violates the game/category foreign key.
     */
    public async syncCategories(gameService: GameService) {
        const categories = Object.keys(gameService.getGameCategories());
        const records: Array<{id_category: number, name: string}> = categories.map((name, i) => ({
            id_category: i + 1,
            name,
        }));
        await Category.bulkCreate(records, {updateOnDuplicate: ['name']});
    }

    public get sequelize(): Sequelize {
        return this._sequelize;
    }

    /**
     * Perform all migrations and seeds
     */
    public async update() {
        return new Promise<void>((resolve, reject) => {
            const umzug = new Umzug({
                storage: 'sequelize',
                storageOptions: {
                    sequelize: this.sequelize,
                },
                migrations: {
                    params: [
                        this.sequelize.getQueryInterface(),
                        Sequelize,
                        () => {
                            throw new Error('Migration tried to use old style "done" callback.');
                        },
                    ],
                    path: process.env.NODE_ENV === 'development' ? './migrations' : join(process.resourcesPath!, 'migrations'),
                    pattern: /\.js$/,
                    customResolver(path: string): { up: () => PromiseLike<any>; down?: () => PromiseLike<any> } {
                        return require('../../migrations/' + basename(path, '.js'));
                    },
                },
            });

            umzug.up().then((migrations) => {
                for (const migration of migrations) {
                    Log.log('[Database] Migration "' + migration.file + '\' success.');
                }
                resolve();
            })
                .catch((error) => {
                    Log.error('[Migration] Error on migration.');
                    Log.error(error);
                    reject(error);
                });
        });
    }
}
