import {exec} from 'child_process';

export default class HiScore {
    protected getHiscore() {
        exec('java -jar hi2txt.jar -descr ./db -r ~/mame/hi/game_name/game_name.hi');
    }
}
