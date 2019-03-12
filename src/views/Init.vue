<template>
    <p>{{msg}}</p>
</template>

<script lang="ts">
import {Component, Vue} from 'vue-property-decorator';
import {remote} from 'electron';
import GameService from '@/class/GameService.class';
import Config from '@/class/Config.class';

@Component
export default class Init extends Vue {
    protected msg: string = 'Chargement';

    public mounted() {
        const config: Config = this.$store.getters.config;
        const mame = this.$store.getters.mame;
        const gameList = this.$store.getters.gameList;

        new Promise((resolve, reject) => {
            try {
                this.msg = 'Loading configuration file';
                config.load();
                this.msg = 'Loading MAME configuration files';
                mame.init(config.mameIniPath);
                this.msg = 'Loading games';
                gameList.init(config.gamesJsonPath);
                const gameService = new GameService(config, mame, gameList);
                this.msg = 'Updating games';
                gameService.refreshGameDir();
                gameList.init(config.gamesJsonPath);
                this.msg = 'Loading marquees';
                gameService.loadGamesMarquee();
                resolve();
            } catch (e) {
                reject(e.toString());
            }
        }).then(
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
}

</script>

<style scoped>
    p { color: red }
</style>
