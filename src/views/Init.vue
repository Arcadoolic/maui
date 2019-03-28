<template>
    <p>{{msg}}</p>
</template>

<script lang="ts">
import {Component, Vue} from 'vue-property-decorator';
import {remote} from 'electron';
import GameService from '@/class/GameService.class';
import Config from '@/class/Config.class';
import HiScore from '@/class/HiScore.class';

@Component
export default class Init extends Vue {
    protected msg: string = 'Chargement';

    public mounted() {
        this.init().then(
            () => {
                if (process.env.NODE_ENV !== 'production' && !process.env.IS_TEST) {
                    remote.getCurrentWindow().setSize(800, 600);
                } else {
                    remote.getCurrentWindow().setSize(screen.width, screen.height);
                    remote.getCurrentWindow().setFullScreen(true);
                }
                this.$store.commit('isInit');
                this.$router.push({name: 'home'});
            },
            (error) => {
                this.msg = error;
            },
        );
    }

    protected init() {
        return new Promise((resolve, reject) => {
            try {
                const config: Config = this.$store.getters.config;
                const mame = this.$store.getters.mame;
                const gameList = this.$store.getters.gameList;

                this.msg = 'Loading configuration file';
                config.load();
                this.msg = 'Loading MAME configuration files';
                mame.init(config.mameIniPath);
                this.msg = 'Loading games';
                gameList.init(config.gamesJsonPath);

                const hiscore = new HiScore(config, mame.mameUiPath);
                this.$store.commit('setHiscore', hiscore);

                const gameService = new GameService(config, mame, gameList, hiscore);
                this.msg = 'Updating games';
                gameService.refreshGameDir();
                gameList.init(config.gamesJsonPath);
                this.msg = 'Loading marquees';
                gameService.loadGamesMarquee();
                this.msg = 'Loading flyers';
                gameService.loadGamesFlyers();
                this.msg = 'Load Hiscores';
                gameService.loadHiscores();
                resolve();
            } catch (e) {
                reject(e.toString());
            }
        });
    }
}

</script>

<style scoped>
    p { color: red }
</style>
