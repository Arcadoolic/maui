import {Column, CreatedAt, DataType, DeletedAt, HasMany, Model, Table, UpdatedAt} from 'sequelize-typescript';
import Hiscore from '@/model/Hiscore.model';
import {PSEUDO3_PATTERN, PSEUDO3_RULE} from '@/class/Pseudo3';

@Table({
    timestamps: true,
    paranoid: true,
    tableName: 'user',
    engine: 'MYISAM',
})
export default class User extends Model<User> {
    @Column({
        primaryKey: true,
        autoIncrement: true,
    })
    public id_user!: number;

    @Column({
        type: DataType.TEXT,
        comment: 'User 2 characters pseudonyme',
        unique: true,
        allowNull: true,
        validate: {
            len: [1, 2],
        },
    })
    public pseudo_2!: string;

    @Column({
        type: DataType.TEXT,
        comment: 'User 3 characters pseudonyme',
        allowNull: false,
        unique: true,
        validate: {
            is: {args: PSEUDO3_PATTERN, msg: PSEUDO3_RULE},
            notNull: true,
        },
    })
    public pseudo_3!: string;

    @Column({
        type: DataType.TEXT,
        comment: 'User real name',
    })
    public realname!: string;

    @Column({
        type: DataType.TEXT,
    })
    public email?: string;

    @Column({
        type: DataType.BOOLEAN,
        defaultValue: 0,
    })
    public active!: boolean;

    @HasMany(() => Hiscore)
    public hiscores!: InstanceType<typeof Hiscore>[];

    @CreatedAt
    public creationDate!: Date;

    @UpdatedAt
    public updatedOn!: Date;

    @DeletedAt
    public deletionDate!: Date;

    // @HasMany(() => Hiscore, 'id_user')
    // public hiscores!: Hiscore[];
}
