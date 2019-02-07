import {exec, ChildProcess} from 'child_process';
import Game from '@/class/Game.class';

export default class Mame {
    protected process?: ChildProcess;

    public start(game: Game) {
        if (!game.romName) {
            return false;
        }

        if (this.process) {
            console.log('KILL');
            console.log(this.process.kill('SIGTERM'));
        }

        if (!this.process) {
            console.log('exec');
            this.process = exec('mame ' + game.romName + ' -autoboot_delay 0', {killSignal: 'SIGKILL'},
                (error, stdout, stderr) => {
                if (error) {
                    console.error(`exec error: ${error}`);
                    return;
                }
                console.log(`stdout: ${stdout}`);
                console.log(`stderr: ${stderr}`);
            });
            this.process.on('close', (e) => {
                console.log('close');
            });
        }
    }
}
