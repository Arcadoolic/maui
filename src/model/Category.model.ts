import {Column, CreatedAt, DataType, DeletedAt, Model, Table, UpdatedAt} from 'sequelize-typescript';

@Table({
    timestamps: true,
    paranoid: true,
    tableName: 'category',
    engine: 'MYISAM',
})
export default class Category extends Model {
    @Column({
        primaryKey: true,
        autoIncrement: true,
    })
    public id_category!: number;

    @Column({
        type: DataType.TEXT,
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
}
