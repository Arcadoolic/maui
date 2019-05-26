import {existsSync} from 'fs';
import {join} from 'path';
import {remote} from 'electron';
import {Sequelize} from 'sequelize-typescript';
import Category from '@/model/Category.model';

export default class Database {
    protected databasePath!: string;
    protected _sequelize!: Sequelize;

    public constructor() {
        this.databasePath = join(
            (process.env.NODE_ENV === "development" ? '.' : remote.app.getPath('userData')),
            'mame-awesome-ui.sqlite',
        );
        this._sequelize = new Sequelize({
            dialect: 'sqlite',
            storage: this.databasePath,
            models: [Category],
        });
    }

    public exist() {
        return existsSync(this.databasePath);
    }

    public async install() {
        this.sequelize.sync();

        // Create categories
        await Category.bulkCreate([
            {name: 'Ball & Paddle'},
            {name: 'Board Game'},
            {name: 'Calculator'},
            {name: 'Casino'},
            {name: 'Climbing'},
            {name: 'Coin Pusher'},
            {name: 'Computer'},
            {name: 'Driving'},
            {name: 'Electromechanical'},
            {name: 'Fighter'},
            {name: 'Game Console'},
            {name: 'Handheld'},
            {name: 'Maze'},
            {name: 'Medal Game'},
            {name: 'Medical Equipment'},
            {name: 'Misc.'},
            {name: 'MultiGame'},
            {name: 'Multiplay'},
            {name: 'Music'},
            {name: 'Platform'},
            {name: 'Printer'},
            {name: 'Puzzle'},
            {name: 'Quiz'},
            {name: 'Rhythm'},
            {name: 'Shooter'},
            {name: 'Slot Machine'},
            {name: 'Sports'},
            {name: 'System'},
            {name: 'Tabletop'},
            {name: 'Telephone'},
            {name: 'Utilities'},
            {name: 'Whac-A-Mole'},
        ]);
    }

    public get sequelize(): Sequelize {
        return this._sequelize;
    }
}
