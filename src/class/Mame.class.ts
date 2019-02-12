import {execFile, ChildProcess} from 'child_process';
import Game from '@/class/Game.class';

export default class Mame {
    protected process?: ChildProcess;

    /**
     * Start a mame game, if a process is already on, kill it
     * @param game
     */
    public start(game: Game) {
        if (!game.romName) {
            return false;
        }

        this.stop().then(
            () => {
                this.process = execFile('/usr/games/mame', [game.romName!, '-nomax', '-w'], {killSignal: 'SIGQUIT'},
                    (error, stdout, stderr) => {
                        if (error) {
                            console.error(`exec error: ${error}`);
                            return;
                        }
                        console.log(`stdout: ${stdout}`);
                        console.log(`stderr: ${stderr}`);
                    });
                this.process.on('close', (e) => {
                    console.log('CLOSE');
                    this.process = undefined;
                });
        });
    }


    /**
     * Stop mame process
     */
    public stop(): Promise<void> {
        return new Promise((resolve, reject) => {
            if (!this.process) {
                return resolve();
            }
            this.process.kill('SIGQUIT');
            this.process.on('exit', (e) => {
                return resolve();
            });
        });
    }

    /**
     * @return boolean
     */
    public get isGameOn() {
        return this.process;
    }
}
