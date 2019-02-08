import {execFile, ChildProcess} from 'child_process';
import Game from '@/class/Game.class';

export default class Mame {
    protected process?: ChildProcess;

    public start(game: Game) {
        if (!game.romName) {
            return false;
        }

        this.stop();
        if (!this.process) {
            this.process = execFile('/usr/games/mame', [game.romName, '-nomax', '-w'], {killSignal: 'SIGQUIT'},
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
        }
    }

    public stop() {
        if (this.process) {
            this.process.kill('SIGQUIT');
            console.log(this.process);
            if (this.process.killed) {
                this.process = undefined;
            } else {
                console.error('Not killed');
            }
        }
    }

    /**
     * @return boolean
     */
    public get isGameOn() {
        return this.process;
    }
}
