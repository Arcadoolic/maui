import {BelongsTo, Column, CreatedAt, ForeignKey, HasOne, Model, Table, UpdatedAt} from 'sequelize-typescript';
import Game from '@/model/Game.model';

@Table({
    timestamps: true,
    paranoid: false,
    tableName: 'game_history',
    engine: 'MYISAM',
})
export default class GameHistoryModel extends Model<GameHistoryModel> {
    @Column({
        primaryKey: true,
        autoIncrement: true,
    })
    public id_game_history!: number;

    @ForeignKey(() => Game)
    @Column
    public id_game!: number;

    @BelongsTo(() => Game)
    public game!: Game;

    @CreatedAt
    public creationDate!: Date;

    @UpdatedAt
    public updatedOn!: Date;
}
