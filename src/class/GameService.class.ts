import {readFileSync, readdirSync} from 'fs';
import {parse as iniParse} from 'ini';
import Game from '@/model/Game.model';
import MameService from '@/class/MameService.class';
import Category from '@/model/Category.model';
import HiscoreService from '@/class/HiscoreService.class';
import Log from 'electron-log';

export default class GameService {
    protected static genreIni?: { [genre: string]: { [romName: string]: boolean } };
    protected static nplayersIni?: { [romName: string]: { [romName: string]: boolean } };

    protected static nplayersTranslation: { [k: string]: Nplayers } = {
        '12P sim': {sim: 12, alt: 0},
        '1P': {sim: 0, alt: 0},
        '2P alt': {sim: 0, alt: 2},
        '2P sim': {sim: 2, alt: 0},
        '3P alt': {sim: 0, alt: 3},
        '3P sim': {sim: 3, alt: 0},
        '4P alt': {sim: 0, alt: 4},
        '4P alt / 2P sim': {sim: 2, alt: 4},
        '4P sim': {sim: 4, alt: 0},
        '5P alt': {sim: 0, alt: 5},
        '6P alt': {sim: 0, alt: 6},
        '6P alt / 2P sim': {sim: 2, alt: 6},
        '6P sim': {sim: 6, alt: 0},
        '8P alt / 2P sim': {sim: 2, alt: 8},
        '8P sim': {sim: 8, alt: 0},
        '9P alt': {sim: 0, alt: 9},
    };

    protected games?: Game[];
    protected mameService!: MameService;
    protected hiService!: HiscoreService;

    public constructor(mameService: MameService, hiService: HiscoreService) {
        this.mameService = mameService;
        this.hiService = hiService;
    }

    /**
     * Save games in database
     * @param romNames
     */
    public async saveGamesFromRomNames(romNames: string[]) {
        // Game is paranoid: a game dropped from favorites.ini below is only soft-deleted, its row
        // stays (romName is unique). Restore the ones back in favorites first - otherwise
        // findAll() below can't see them, they take the "new game" path, and bulkCreate's
        // updateOnDuplicate refreshes their columns but leaves deletedAt set, so they stay hidden.
        await Game.restore({where: {romName: romNames}});
        const existingGames = (await Game.findAll()).map((game) => {
            return game.romName;
        });
        // TODO : What to do if rom is invalid ?
        const games: any[] = [];

        // Disable unwanted games
        const romToDisable = existingGames.filter((i) => romNames.indexOf(i) < 0);
        Game.destroy({ where: { romName: romToDisable }} );

        for (const romName of romNames) {
            if (existingGames.indexOf(romName) >= 0) {
                // Re-derived from genre.ini/Multiplayer.ini on every sync, not just once at
                // creation: both are optional and can be added (or replaced by a newer starting
                // pack) after a game already exists in the database, and the ini lookups
                // themselves are cheap (cached parses, no `mame -lx` subprocess) - unlike the
                // rest of a game's info below, which is deliberately only fetched once.
                const players = this.getGameNplayers(romName);
                games.push({
                    romName,
                    hi: this.hiService.hasHiscore(romName),
                    id_category: this.getGameCategoryId(romName),
                    player_alt: players.alt,
                    player_sim: players.sim,
                });
                continue;
            }

            // Get game information from mame
            const gameInformation = this.mameService.getGameInformation(romName);

            // Extract shortname and subname
            let shortname = gameInformation.description;
            let subname = '';
            const shortnameRegexp = /^(.[^(]*)/g.exec(gameInformation.description);
            if (shortnameRegexp) {
                shortname = shortnameRegexp[0].trim().replace(/&amp;/g, '&');
                const subnameRegexp = /^([^\-\/]*)(:\s+|\s+-\s+|\s+\/\s+)(.*)$/.exec(shortname);
                if (subnameRegexp) {
                    shortname = subnameRegexp.splice(0, 3)[1];
                    subname = subnameRegexp[0];
                }
            }

            // Get player numbers
            const players = this.getGameNplayers(romName);
            games.push({
                id_category: this.getGameCategoryId(romName),
                romName,
                fullname: gameInformation.description,
                shortname,
                subname,
                manufacturer: gameInformation.manufacturer,
                year: gameInformation.year,
                hi: this.hiService.hasHiscore(romName),
                player_alt: players.alt,
                player_sim: players.sim,
            });
        }
        await Game.bulkCreate(games, {
            updateOnDuplicate: ['hi', 'id_category', 'player_alt', 'player_sim'],
            logging: Log.log,
        });
    }

    /**
     * Load and parse genre.ini - the real, per-mame-version categorization dataset
     * (MameService.genreIniPath, resolved from ui.ini's categorypath), never the app's own
     * bundled data. Optional: genre.ini is only ever installed by a starting pack import, so
     * when it's absent (no import done yet, or a MAME version without a "folders" pack) this
     * returns an empty set of categories instead of throwing - callers then see "no category"
     * for every rom, which is how the UI falls back to a flat game list (see Home.vue).
     */
    public getGameCategories() {
        if (!GameService.genreIni) {
            GameService.genreIni = this.mameService.genreIniPath
                ? iniParse(readFileSync(this.mameService.genreIniPath, 'utf8'))
                : {};
        }
        return GameService.genreIni;
    }

    /**
     * Return category id for a romName, or undefined if genre.ini is absent or doesn't
     * categorize this rom.
     * @param romName
     */
    public getGameCategoryId(romName: string) {
        const genreIni = this.getGameCategories();
        const categories = Object.keys(genreIni);
        for (const category of categories) {
            if (genreIni[category][romName]) {
                return categories.indexOf(category) + 1;
            }
        }
    }

    /**
     * Load and parse Multiplayer.ini - the real, per-mame-version player-count dataset
     * (MameService.nplayersIniPath, resolved from ui.ini's categorypath), never the app's own
     * bundled data. Optional, same as genre.ini: when absent, every rom falls through to the
     * {sim: 0, alt: 0} default below instead of throwing.
     * @param romName
     */
    public getGameNplayers(romName: string): Nplayers {
        if (!GameService.nplayersIni) {
            GameService.nplayersIni = this.mameService.nplayersIniPath
                ? iniParse(readFileSync(this.mameService.nplayersIniPath, 'utf8'))
                : {};
        }
        for (const nplayers in GameService.nplayersIni) {
            if (GameService.nplayersIni[nplayers][romName]) {
                if (GameService.nplayersTranslation[nplayers]) {
                    return GameService.nplayersTranslation[nplayers];
                } else {
                    break;
                }
            }
        }

        return {
            sim: 0,
            alt: 0,
        };
    }

    /**
     * Load games from database
     */
    public async loadGames() {
        if (this.games === undefined) {
            this.games = await Game.findAll({
                order: ['romName'],
            });
        }
        return this.games;
    }

    /**
     * Games whose high scores can be extracted (`hi`, the same flag that shows the champions on
     * their marquee in the carousel) - the content of the dynamic "Hiscores Only" category.
     * Queried on every call (never cached like loadGames()), so it always reflects the table.
     */
    public async loadHiscoreGames() {
        return await Game.findAll({
            where: {hi: true},
            order: ['romName'],
        });
    }

    /**
     * Games of several stored categories at once (a merged carousel entry, see
     * mergeTtlCategories()), in the same order as "All games".
     */
    public async loadGamesByCategoryIds(categoryIds: number[]) {
        return await Game.findAll({
            where: {id_category: categoryIds},
            order: ['romName'],
        });
    }

    /**
     * Load categories from database
     */
    public async loadCategories() {
        return await Category.findAll({
            order: ['name'],
            include: [{model: Game, required: true}],
        });
    }

    /**
     * Read marquees dir
     */
    public loadMarquees() {
        if (this.mameService.uiIni && this.mameService.uiIni.marquees_directory) {
            const marqueesDirectory = this.mameService.marqueePath;
            return marqueesDirectory ? readdirSync(marqueesDirectory) : [];
        }
        return [];
    }

    /**
     * Read flyers dir
     */
    public loadFlyers() {
        if (this.mameService.uiIni && this.mameService.uiIni.flyers_directory) {
            const flyerDirectory = this.mameService.flyerPath;
            return flyerDirectory ? readdirSync(flyerDirectory) : [];
        }
        return [];
    }

    /**
     * Read logos ("wheel" art) dir
     */
    public loadLogos() {
        if (this.mameService.uiIni && this.mameService.uiIni.logos_directory) {
            const logoDirectory = this.mameService.logoPath;
            return logoDirectory ? readdirSync(logoDirectory) : [];
        }
        return [];
    }
}
