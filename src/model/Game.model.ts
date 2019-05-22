import {BelongsTo, Column, ForeignKey, Model, Table} from 'sequelize-typescript';
import Category from './Category.model';

@Table({
    timestamps: true,
    paranoid: true,
    tableName: 'game',
    engine: 'MYISAM',
})
export default class Game extends Model {
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
}
