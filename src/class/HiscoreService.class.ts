import MameHiExtractor from 'mame-hi-extractor';
import UserService from '@/class/UserService.class';
import Hiscore from '@/model/Hiscore.model';
import Game from '@/model/Game.model';
import * as Log from 'electron-log';

export default class HiscoreService {
    protected hiExtractor!: MameHiExtractor;
    protected userService!: UserService;

    public constructor(mamePath: string, userService: UserService) {
        this.hiExtractor = new MameHiExtractor(mamePath);
        this.userService = userService;
    }

    /**
     * Get hiscore from a romName
     * @param romName
     */
    public getHiscore(romName: string) {
        return this.hiExtractor.get(romName);
    }

    /**
     * Check if rom have hiscore extraction
     * @param romName
     */
    public hasHiscore(romName: string) {
        return this.hiExtractor.exist(romName);
    }

    /**
     * Save hiscores from one or multiples Game
     * TODO : Better error handling
     * @param games
     */
    public async saveHiscores(games: Game[]|Game) {
        if (!Array.isArray(games)) {
            games = [games];
        }
        for (const game of games) {
            try {
                const hiscore = this.hiExtractor.get(game.romName);
                if (!hiscore) {
                    continue;
                }

                const scoreToSave: any[] = [];
                for (const score of hiscore.default) {
                    const user = this.userService.getUserByPseudo3(score.name.substr(0, 3).toUpperCase());
                    if (!user) {
                        continue;
                    }
                    scoreToSave.push({
                        id_game: game.id_game,
                        id_user: user.id_user,
                        rank: score.rank,
                        score: score.score,
                    });
                }
                try {
                    game.hiscores = await Hiscore.bulkCreate(scoreToSave, {
                        ignoreDuplicates: true,
                    });
                } catch (e) {
                    Log.error('[HiscoreService] Failed to save hiscores for id_game ' + game.id_game + ' in database.');
                    Log.error(e);
                }
            } catch (e) {
                Log.error('[HiscoreService] Error on hiscores saving.');
                Log.error(e);
            }
        }
    }
}
