import {existsSync, mkdirSync} from 'fs';
import {join} from 'path';
import * as os from 'os';
import * as SequelizeTS from 'sequelize-typescript';
const Sequelize = SequelizeTS.Sequelize;
type Sequelize = SequelizeTS.Sequelize;
import Category from '@/model/Category.model';
import GameService from '@/class/GameService.class';
import Game from '@/model/Game.model';
import User from '@/model/User.model';
import Hiscore from '@/model/Hiscore.model';
import * as Log from 'electron-log';
import {runMigrations} from '@/class/Migrations';

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
            // BoUser is deliberately excluded here: it's created (and seeded) exclusively by the
            // create-bo-user migration below, not by sync(). sync() creates tables straight from
            // the current model definitions with no seed data, so if it also created bo_user,
            // the login accounts would never exist and the next update() run would fail with
            // "table bo_user already exists" when the migration tries to create it itself.
            models: [Category, Game, User, Hiscore],
            logging: false,
        });
    }

    public exist() {
        return existsSync(this.databasePath);
    }

    public async install() {
        await this.sequelize.sync();
        // Runs the migrations (including the bo_user creation/seed) right away instead of
        // waiting for a second launch's update() call - see this constructor's models comment.
        await this.update();
    }

    /**
     * (Re)seeds the category table from genre.ini, or catver.ini when installed (see
     * GameService.getGameCategories()). genre.ini is only ever installed by a starting pack
     * import (see scripts/import-starting-pack.py); both are optional - possibly added (or replaced by a newer pack) well after the database
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
        await runMigrations(this.sequelize, Log);
    }
}
