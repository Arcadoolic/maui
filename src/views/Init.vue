<template>
    <div></div>
</template>

<script lang="ts">
import {Component, Vue} from 'vue-property-decorator';
import GameService from '@/class/GameService.class';
import Config from '@/class/Config.class';
import HiscoreService from '@/class/HiscoreService.class';
import Players from '@/class/Players.class';
import IPDDatabase from '@/class/IPDDatabase.class';
import {ipcRenderer} from 'electron';
import {appendFileSync} from 'fs';

@Component
export default class Init extends Vue {
    protected msg: string = 'Chargement';

    public async mounted() {
        this.init();
    }

    protected async init() {
        try {
            const config: Config = this.$store.getters.config;
            const mame = this.$store.getters.mame;
            const gameList = this.$store.getters.gameList;

            console.log('Loading configuration file');
            config.load();
            console.log('Loading MAME configuration files');
            mame.init(config.mameIniPath);
            console.log('Loading games');
            gameList.init(config.gamesJsonPath);

            const hiscore = new HiscoreService(config, mame.mameUiPath);
            this.$store.commit('setHiscore', hiscore);

            const gameService = new GameService(config, mame, gameList, hiscore);
            console.log('Updating games');
            gameService.refreshGameDir();
            gameList.init(config.gamesJsonPath);
            console.log('Loading marquees');
            gameService.loadGamesMarquee();
            console.log('Loading flyers');
            gameService.loadGamesFlyers();
            console.log('Load Hiscores');
            gameService.loadHiscores().then(() => {
                    console.log('Load players');
                    const players = new Players(config.faceyourmangaPath);
                    this.$store.commit('setPlayers', players);
                    players.init();

                    // DB
                    // TODO : Refacto
                    const db = new IPDDatabase(config, players);
                    this.$store.commit('setDb', db);
                    console.log('Init database');
                    db.connect().then(
                        () => {
                            console.log('Initialisation done');
                            this.$store.commit('isInit');
                            ipcRenderer.send('init-end');
                            this.$router.push({name: 'home'});
                        },
                        (err) => {
                            appendFileSync('~/arcade_error.log', '[' + Date.now() +' ]' + err);
                            console.error(err);
                        },
                    );
            });
        } catch (e) {
            console.error(e.toString());
        }
    }
}

</script>

<style scoped>
    div {
        display: block;
        width: 100%;
        height: 100%;
        background-color: #000000;
        background-image:  url(../assets/splash_screen_arcade.png);
        background-size: cover;
        background-repeat: repeat;
        background-position: 0 0;
    }
</style>
