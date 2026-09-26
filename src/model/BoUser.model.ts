import {Column, CreatedAt, DataType, Model, Table, UpdatedAt} from 'sequelize-typescript';

/**
 * A BO (back office) login account - distinct from User.model.ts, which is the arcade-cabinet
 * player profile (pseudo/avatar/hiscores) managed from the BO's own "Players" tab. A single
 * account (puckman) since the admin one was dropped: the bo_user table still has a legacy `role`
 * column (see migrations/20260925090000-drop-bo-admin-user.js), deliberately not mapped here.
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

    // Data key of the config file's encrypted credentials, wrapped with this account's password
    // (see SecretBox.ts) - null until the first sign-in with a non-default password.
    @Column({
        type: DataType.TEXT,
        allowNull: true,
    })
    public secretsKey!: string | null;

    @CreatedAt
    public creationDate!: Date;

    @UpdatedAt
    public updatedOn!: Date;
}
