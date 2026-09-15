import {Column, CreatedAt, DataType, DeletedAt, HasMany, Model, Table, UpdatedAt} from 'sequelize-typescript';
import Game from '@/model/Game.model';

@Table({
    timestamps: true,
    paranoid: true,
    tableName: 'category',
    engine: 'MYISAM',
})
export default class Category extends Model<Category> {
    @Column({
        primaryKey: true,
        autoIncrement: true,
    })
    public id_category!: number;

    @Column({
        type: DataType.TEXT,
        allowNull: false,
        validate: {
            notNull: true,
        },
    })
    public name!: string;

    @CreatedAt
    public creationDate!: Date;

    @UpdatedAt
    public updatedOn!: Date;

    @DeletedAt
    public deletionDate!: Date;

    @HasMany(() => Game)
    public games!: InstanceType<typeof Game>[];
}
