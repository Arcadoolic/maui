import {
    BelongsTo,
    Column,
    CreatedAt,
    DataType,
    DeletedAt,
    ForeignKey,
    Model,
    Table,
    UpdatedAt,
} from 'sequelize-typescript';
import Game from '@/model/Game.model';
import User from '@/model/User.model';

@Table({
    timestamps: true,
    paranoid: true,
    tableName: 'hiscore',
    engine: 'MYISAM',
    indexes: [{
        unique: true,
        fields: ['id_game', 'id_user', 'rank', 'score', 'extraName'],
    }],
})
export default class Hiscore extends Model<Hiscore> {
    @Column({
        primaryKey: true,
        autoIncrement: true,
    })
    public id_hiscore!: number;

    @ForeignKey(() => Game)
    @Column({
        unique: 'uniqueScore',
    })
    public id_game!: number;

    @BelongsTo(() => Game)
    public game!: InstanceType<typeof Game>;

    @ForeignKey(() => User)
    @Column({
        unique: 'uniqueScore',
    })
    public id_user!: number;

    @BelongsTo(() => User, 'id_user')
    public user!: InstanceType<typeof User>;

    @Column({
        type: DataType.INTEGER,
        unique: 'uniqueScore',
    })
    public rank!: number;

    @Column({
        type: DataType.INTEGER,
        unique: 'uniqueScore',
    })
    public score!: number;

    @Column({
        type: DataType.STRING,
        defaultValue: '',
        unique: 'uniqueScore',
    })
    public extraName?: string;

    @Column({
        type: DataType.STRING,
    })
    public scoreSuffix?: string;

    @CreatedAt
    public creationDate!: Date;

    @UpdatedAt
    public updatedOn!: Date;

    @DeletedAt
    public deletionDate!: Date;
}
