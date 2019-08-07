import {existsSync} from 'fs';
import {join} from 'path';
import {remote} from 'electron';
import {Sequelize} from 'sequelize-typescript';
import Category from '@/model/Category.model';
import GameService from '@/class/GameService.class';
import Game from '@/model/Game.model';
import User from '@/model/User.model';
import Hiscore from '@/model/Hiscore.model';

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
}
