<template>
    <div>
        <p>Starting Arcade !</p>
        <p>{{msg}}</p>
    </div>
</template>

<script lang="ts">
import {Component, Vue} from 'vue-property-decorator';
import GameService from '@/class/GameService.class';
import Config from '@/class/Config.class';
import HiscoreService from '@/class/HiscoreService.class';
import Players from '@/class/Players.class';
import IPDDatabase from '@/class/IPDDatabase.class';
import {ipcRenderer} from 'electron';

@Component
export default class Init extends Vue {
    protected msg: string = 'Chargement';

    public mounted() {
        setTimeout(() => {
            this.init().then(
                () => {
                    this.$store.commit('isInit');
                    ipcRenderer.send('init-end');
                    this.$router.push({name: 'home'});
                },
                (error) => {
                    console.error(error);
                },
            );
        }, 100);
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

                const hiscore = new HiscoreService(config, mame.mameUiPath);
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
                gameService.loadHiscores().then(() => {
                        this.msg = 'Load players';
                        const players = new Players(config.faceyourmangaPath);
                        this.$store.commit('setPlayers', players);
                        players.init();

                        // DB
                        // TODO : Refacto
                        const db = new IPDDatabase(config);
                        this.$store.commit('setDb', db);
                        this.msg = 'Init database';
                        db.connect().then(
                            () => {
                                resolve();
                            },
                            (err) => {
                                reject(err);
                            },
                        );
                });
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
