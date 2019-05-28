import {BelongsTo, Column, DataType, ForeignKey, Model, Table} from 'sequelize-typescript';
import Category from './Category.model';

@Table({
    timestamps: true,
    paranoid: true,
    tableName: 'game',
    engine: 'MYISAM',

})
export default class Game extends Model<Game> {
    @Column({
        primaryKey: true,
        autoIncrement: true,
    })
    public id_game!: number;

    @ForeignKey(() => Category)
    @Column
    public id_category!: number;

    @BelongsTo(() => Category)
    public category!: Category;

    @Column({
        type: DataType.TEXT,
        unique: true,
    })
    public romName!: string;

    @Column({
        type: DataType.TEXT,
    })
    public fullname!: string;

    @Column({
        type: DataType.TEXT,
    })
    public shortname!: string;

    @Column({
        type: DataType.TEXT,
    })
    public subname!: string;

    @Column({
        type: DataType.TEXT,
    })
    public manufacturer!: string;

    @Column({
        type: DataType.TINYINT,
    })
    public year!: number;

    @Column({
        type: DataType.BOOLEAN,
    })
    public hi!: boolean;

    @Column({
        type: DataType.TINYINT,
        defaultValue: 0,
    })
    public player_alt!: number;

    @Column({
        type: DataType.TINYINT,
        defaultValue: 0,
    })
    public player_sim!: number;
}
