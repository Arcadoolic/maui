import {execFile} from 'child_process';
import parse from 'csv-parse/lib/sync';
import {join} from 'path';
import Config from '@/class/Config.class';
import {writeFileSync, readFileSync} from 'fs';
import MameHiExtractor from 'mame-hi-extractor';
import UserService from '@/class/UserService.class';
import User from '@/model/User.model';
import Hiscore from '@/model/Hiscore.model';
import Game from '@/model/Game.model';

export default class HiscoreService {
    protected hiExtractor!: MameHiExtractor;
    protected userService!: UserService;

    public constructor(mamePath: string, userService: UserService) {
        this.hiExtractor = new MameHiExtractor(mamePath);
        this.userService = userService;
    }

    public getHiscore(romName: string) {
        return this.hiExtractor.get(romName);
    }

    public async saveHiscores(games: Game[]) {
        if (!Array.isArray(games)) {
            games = [games];
        }
        for (let game of games) {
            try {
                const hiscore = this.hiExtractor.get(game.romName);
                if (!hiscore) {
                    continue;
                }

                const scoreToSave: any[] = [];
                for (const score of hiscore.default) {
                    const user = this.userService.getUserByPseudo3(score.name);
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
                    console.error(e);
                }
            } catch (e) {
                console.log(e);
            }
            //
            // for (const extras of hiscore.extras) {
            //     for (const score of extras.scores) {
            //         const user = this.userService.getUserByPseudo3(score.name);
            //         if (!user) {
            //             continue;
            //         }
            //         scoreToSave.push({
            //             id_user: user.id_user,
            //             score: score.score,
            //             extraName: extras.name,
            //             scoreSuffix: score.scoreSuffix,
            //         });
            //     }
            // }

        }
    }

    // protected config!: Config;
    // protected hiPath!: string;
    //
    // public constructor(config: Config, hiPath: string) {
    //     this.config = config;
    //     this.hiPath = hiPath;
    // }
    //
    // /**
    //  * Get hiscores with hi2txt
    //  * @param romName
    //  */
    // public getHiscore(romName: string): Promise<Hiscores> {
    //     return new Promise((resolve, reject) => {
    //         const hi2txtPath = join(process.env.NODE_ENV === 'development'
    //             ? './resources' : process.resourcesPath!, 'hi2txt');
    //         execFile(
    //             'java',
    //             [
    //                 '-jar',
    //                 join(hi2txtPath, 'hi2txt.jar'),
    //                 '-descr',
    //                 join(hi2txtPath, 'hi2txt'),
    //                 '-ra',
    //                 join(this.hiPath, 'hi', romName + '.hi'),
    //             ],
    //             (error, stdout, stderr) => {
    //                 if (error) {
    //                     return reject(error);
    //                 }
    //
    //                 const splitedStdout = stdout.split(/\n{2,}/);
    //                 const ret = {classic: [] as any[], advanced: [] as any[]};
    //                 splitedStdout.forEach((hiscores: string, index) => {
    //                     if (hiscores.trim() === '') {
    //                         return true;
    //                     }
    //                     hiscores = parse(hiscores, {delimiter: '|', columns: true, skip_empty_lines: true});
    //                     if (index) {
    //                         ret.advanced.push(hiscores);
    //                     } else {
    //                         ret.classic.push(hiscores);
    //                     }
    //                 });
    //                 return resolve(ret);
    //             });
    //     });
    // }
    //
    // /**
    //  * Save hiscores in a json file
    //  * @param romName
    //  * @param hiscores
    //  */
    // public saveHiscore(romName: string, hiscoresJson: HiscoresJson): void {
    //     writeFileSync(join(this.config.hiscoresJsonPath, romName + '.json'), JSON.stringify(hiscoresJson));
    // }
    //
    // /**
    //  *
    //  * @param romName
    //  */
    // public loadHiscore(romName: string): HiscoresJson|null {
    //     try {
    //         const hiscores = readFileSync(join(this.config.hiscoresJsonPath, romName + '.json'), 'utf8');
    //         return JSON.parse(hiscores);
    //     } catch (e) {
    //         return null;
    //     }
    // }
}
