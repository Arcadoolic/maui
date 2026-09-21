import {BelongsTo, Column, DataType, ForeignKey, HasMany, HasOne, Model, Table} from 'sequelize-typescript';
import Category from './Category.model';
import Hiscore from '@/model/Hiscore.model';
import {decodeXmlEntities} from '@/class/XmlEntities';
import {studioInParentheses} from '@/class/StudioLabel';

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

    /**
     * Number of times the game was launched from the front-end (see GameService.incrementPlayCount()).
     * Not part of saveGamesFromRomNames()'s updateOnDuplicate list, so a favorites resync keeps it.
     */
    @Column({
        type: DataType.INTEGER,
        allowNull: false,
        defaultValue: 0,
    })
    public play_count!: number;

    /**
     * The cabinet's opinion of the game: 1 thumbs up, 0 neutral (also "not voted yet": both are
     * asked again once the game is quit), -1 thumbs down. See GameVote.ts.
     */
    @Column({
        type: DataType.INTEGER,
        allowNull: false,
        defaultValue: 0,
    })
    public vote!: number;

    /** When the game was last launched from the front-end; null = never played. */
    @Column({
        type: DataType.DATE,
        allowNull: true,
    })
    public last_played_at!: Date | null;

    @HasMany(() => Hiscore)
    public hiscores!: InstanceType<typeof Hiscore>[];

    /**
     * Studio/manufacturer as mame reports it ("Konami", "Capcom", "Atari Games"...), decoded for
     * display; empty when mame gave none.
     */
    public get studio(): string {
        return this.manufacturer ? decodeXmlEntities(this.manufacturer) : '';
    }

    /**
     * The studio for display inside parentheses (year (studio) - players): a license note it
     * already carries in parentheses is flattened, see studioInParentheses().
     */
    public get studioLabel(): string {
        return studioInParentheses(this.studio);
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
