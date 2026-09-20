import {BelongsTo, Column, DataType, ForeignKey, HasMany, HasOne, Model, Table} from 'sequelize-typescript';
import Category from './Category.model';
import Hiscore from '@/model/Hiscore.model';
import {decodeXmlEntities} from '@/class/XmlEntities';

@Table({
    timestamps: true,
    paranoid: true,
    tableName: 'game',
    engine: 'MYISAM',

})
export default class Game extends Model<Game> {
    @Column({
        primaryKey: true,
        autoIncrement: true,
    })
    public id_game!: number;

    @ForeignKey(() => Category)
    @Column
    public id_category!: number;

    @BelongsTo(() => Category, 'id_category')
    public category!: InstanceType<typeof Category>;

    @Column({
        type: DataType.TEXT,
        unique: true,
    })
    public romName!: string;

    @Column({
        type: DataType.TEXT,
    })
    public fullname!: string;

    @Column({
        type: DataType.TEXT,
    })
    public shortname!: string;

    @Column({
        type: DataType.TEXT,
    })
    public subname!: string;

    @Column({
        type: DataType.TEXT,
    })
    public manufacturer!: string;

    @Column({
        type: DataType.TINYINT,
    })
    public year!: number;

    @Column({
        type: DataType.BOOLEAN,
    })
    public hi!: boolean;

    @Column({
        type: DataType.TINYINT,
        defaultValue: 0,
    })
    public player_alt!: number;

    @Column({
        type: DataType.TINYINT,
        defaultValue: 0,
    })
    public player_sim!: number;

    @HasMany(() => Hiscore)
    public hiscores!: InstanceType<typeof Hiscore>[];

    /**
     * Studio/manufacturer as mame reports it ("Konami", "Capcom", "Atari Games"...), decoded for
     * display; empty when mame gave none.
     */
    public get studio(): string {
        return this.manufacturer ? decodeXmlEntities(this.manufacturer) : '';
    }

    public get players() {
        let str: string|null = null;
        if (this.player_alt) {
            str = this.player_alt + ' player' + (this.player_alt > 1 ? 's' : '') + ' alternate';
        }
        if (this.player_sim) {
            str = (str)
                ? str + '/' + this.player_sim + ' player' + (this.player_sim > 1 ? 's' : '') + ' simultaneous'
                : this.player_sim + ' player' + (this.player_sim > 1 ? 's' : '') + ' simultaneous';
        }
        if (!str) {
            str = '1 player';
        }
        return str;
    }
}
