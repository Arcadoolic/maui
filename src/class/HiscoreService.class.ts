import {MameHiExtractor} from '@arcadoolic/mhiex';
import UserService from '@/class/UserService.class';
import Hiscore from '@/model/Hiscore.model';
import Game from '@/model/Game.model';
import * as Log from 'electron-log';
import {scorePseudo3} from '@/class/HiscoreSupport';
import {isOnlineActive} from '@/class/RepositoryAuth';

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
        // Fresh players and ONLINE state for each save: both change behind the renderer's back
        // (BO, ONLINE sync). Only the players allowed to receive scores get them (getScorer()).
        await this.userService.loadUsers();
        const onlineEnabled = isOnlineActive();
        for (const game of games) {
            // No extractor in mhiex for this game: nothing to read. get() would throw "is not a
            // constructor" instead of answering undefined (issue #100).
            if (!this.hiExtractor.exist(game.romName)) {
                continue;
            }
            try {
                const hiscoreExtractor = await this.hiExtractor.get(game.romName);
                if (!hiscoreExtractor) {
                    continue;
                }
                const hiscore = hiscoreExtractor.extract(false).scores;
                const scoreToSave: any[] = [];
                for (const score of hiscore.default) {
                    const user = this.userService.getScorer(scorePseudo3(score.name), onlineEnabled);
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
                    Log.debug('[HiscoreService] Scores to save for game ' + game.id_game + '.');
                    Log.debug(scoreToSave);
                    game.hiscores = await Hiscore.bulkCreate(scoreToSave, {
                        ignoreDuplicates: true,
                    });
                } catch (e) {
                    Log.error('[HiscoreService] Failed to save hiscores for id_game ' + game.id_game + ' in database.');
                    Log.error(e);
                }
            } catch (e) {
                if ((e as NodeJS.ErrnoException).code === 'ENOENT') {
                    // No .hi file yet: the game hasn't been played long enough to produce a
                    // score. mhiex's exist()/hasHiscore() only checks whether the
                    // rom is a *supported* game, not whether its .hi file is actually present
                    // on disk - get() itself throws ENOENT for that case. Not an error.
                    continue;
                }
                Log.error('[HiscoreService] Error on hiscores saving.');
                Log.error(e);
            }
        }
    }
}
