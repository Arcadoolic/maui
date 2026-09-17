import {Column, CreatedAt, DataType, Model, Table, UpdatedAt} from 'sequelize-typescript';

/**
 * A BO (back office) login account - distinct from User.model.ts, which is the arcade-cabinet
 * player profile (pseudo/avatar/hiscores) managed from the BO's own "Players" tab.
 */
@Table({
    timestamps: true,
    tableName: 'bo_user',
})
export default class BoUser extends Model<BoUser> {
    @Column({
        primaryKey: true,
        autoIncrement: true,
    })
    public id!: number;

    @Column({
        type: DataType.TEXT,
        allowNull: false,
        unique: true,
    })
    public username!: string;

    @Column({
        type: DataType.TEXT,
        allowNull: false,
    })
    public passwordHash!: string;

    @Column({
        type: DataType.TEXT,
        allowNull: false,
        defaultValue: 'user',
    })
    public role!: 'admin' | 'user';

    @CreatedAt
    public creationDate!: Date;

    @UpdatedAt
    public updatedOn!: Date;
}
