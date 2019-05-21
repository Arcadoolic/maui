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
        this.$store.commit('initLogger', './arcade.log');
        const logger = this.$store.getters.logger;

        try {
            const config: Config = this.$store.getters.config;
            const mame = this.$store.getters.mame;
            const gameList = this.$store.getters.gameList;

            config.load(); // Loading config
            this.$store.commit('initPlayers'); // Loading players
            this.$store.commit('initDatabase'); // Init database
            mame.init(config.mameIniPath); // Init mame config
            gameList.init(config.gamesJsonPath); // Init gameList

            this.$store.commit('initHiscores'); // Init Hiscores
            this.$store.commit('initGameService');
            const gameService = this.$store.getters.gameService;
            gameService.refreshGameDir(); // Refresh gameList
            gameService.loadGamesMarquee();
            gameService.loadGamesFlyers();

            await this.$store.getters.db.connect();
            await gameService.loadHiscores();
            this.$store.getters.db.end();

            this.$store.commit('isInit');
            ipcRenderer.send('init-end');
            this.$router.push({name: 'home'});
        } catch (e) {
            logger.logError('[Init] ' + e.toString());
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
