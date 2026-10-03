import {Column, CreatedAt, DataType, DeletedAt, HasMany, Model, Table, UpdatedAt} from 'sequelize-typescript';
import Hiscore from '@/model/Hiscore.model';
import {PSEUDO3_PATTERN, PSEUDO3_RULE} from '@/class/Pseudo3';
import type {OnlinePlayerStatus} from '@/class/MauiApiClient';

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

    // ONLINE (MAUI-API, see migrations/20261002090000-user-online-player.js): the player's id in
    // the API, null while local only.
    @Column({
        type: DataType.TEXT,
        allowNull: true,
        unique: true,
    })
    public remote_id!: string | null;

    // Shown in the shared leaderboards. Private by default.
    @Column({
        type: DataType.BOOLEAN,
        allowNull: false,
        defaultValue: false,
    })
    public is_public!: boolean;

    // Last status reported by MAUI-API: 'active', 'disabled' or 'locked'; null when not linked.
    @Column({
        type: DataType.TEXT,
        allowNull: true,
    })
    public online_status!: OnlinePlayerStatus | null;

    // MAUI-API says the player was created on this cabinet: the only one that may issue a new PIN
    // (maui-api D54).
    @Column({
        type: DataType.BOOLEAN,
        allowNull: false,
        defaultValue: false,
    })
    public is_origin!: boolean;

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
