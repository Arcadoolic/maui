import {
    BelongsTo,
    Column,
    CreatedAt,
    DataType,
    DeletedAt,
    ForeignKey,
    Model,
    Table,
    UpdatedAt
} from 'sequelize-typescript';
import Game from '@/model/Game.model';
import User from '@/model/User.model';

@Table({
    timestamps: true,
    paranoid: true,
    tableName: 'hiscore',
    engine: 'MYISAM',
})
export default class Hiscore extends Model<Hiscore> {
    @Column({
        primaryKey: true,
        autoIncrement: true,
    })
    public id_hiscore!: number;

    @ForeignKey(() => Game)
    @Column
    public id_game!: number;

    @BelongsTo(() => Game)
    public game!: Game;

    @ForeignKey(() => User)
    @Column
    public id_user!: number;

    @BelongsTo(() => User)
    public user!: User;

    @Column({
        type: DataType.INTEGER,
    })
    public score!: number;

    @CreatedAt
    public creationDate!: Date;

    @UpdatedAt
    public updatedOn!: Date;

    @DeletedAt
    public deletionDate!: Date;
}
