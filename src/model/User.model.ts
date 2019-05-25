import {Column, CreatedAt, DataType, DeletedAt, Model, Table, UpdatedAt} from 'sequelize-typescript';

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
        validate: {
            len: [1, 2],
        },
    })
    public pseudo_2!: string;

    @Column({
        type: DataType.TEXT,
        comment: 'User 3 characters pseudonyme',
        allowNull: false,
        validate: {
            len: [1, 3],
            notNull: true,
        },
    })
    public pseudo_3!: string;

    @Column({
        type: DataType.TEXT,
        comment: 'User real name',
    })
    public realname!: string;

    @CreatedAt
    public creationDate!: Date;

    @UpdatedAt
    public updatedOn!: Date;

    @DeletedAt
    public deletionDate!: Date;
}
