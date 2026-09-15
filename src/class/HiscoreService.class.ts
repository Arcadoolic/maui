import {lstatSync, symlinkSync} from 'fs';
import {join} from 'path';
import MameHiExtractor from 'mame-hi-extractor';
import UserService from '@/class/UserService.class';
import Hiscore from '@/model/Hiscore.model';
import Game from '@/model/Game.model';
import * as Log from 'electron-log';

export default class HiscoreService {
    protected hiExtractor!: MameHiExtractor;
    protected userService!: UserService;

    public constructor(mamePath: string, userService: UserService) {
        HiscoreService.ensureHiSymlink(mamePath);
        this.hiExtractor = new MameHiExtractor(mamePath);
        this.userService = userService;
    }

    /**
     * mame-hi-extractor reads <mamePath>/hi/<romName>.hi (hardcoded in its AbstractExtractor),
     * but mame's own hiscore plugin actually writes to <mamePath>/hiscore/<romName>.hi. Bridge
     * that mismatch with a symlink instead of patching the third-party dependency.
     */
    protected static ensureHiSymlink(mamePath: string) {
        const hiPath = join(mamePath, 'hi');
        try {
            lstatSync(hiPath);
            return; // already a symlink, directory or file here - leave it alone
        } catch {
            // nothing at hiPath yet
        }
        try {
            symlinkSync('hiscore', hiPath, 'dir');
        } catch (e) {
            Log.error('[HiscoreService] Failed to create the "hi" -> "hiscore" symlink.');
            Log.error(e);
        }
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
                const hiscoreExtractor = this.hiExtractor.get(game.romName);
                if (!hiscoreExtractor) {
                    continue;
                }
                const hiscore = hiscoreExtractor.extract(false).scores;
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
                    // score. mame-hi-extractor's exist()/hasHiscore() only checks whether the
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
