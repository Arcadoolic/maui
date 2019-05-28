<template>
    <div></div>
</template>

<script lang="ts">
import {Component, Vue} from 'vue-property-decorator';
import {ipcRenderer, remote} from 'electron';
import Config from '@/class/Config.class';
import {join} from 'path';
import MameService from "@/class/MameService.class";
import GameService from '@/class/GameService.class';
import Database from '@/class/Database.class';

@Component
export default class Init extends Vue {
    protected msg: string = 'Chargement';

    public created() {
        remote.getCurrentWindow().setSize(346, 354);
        remote.getCurrentWindow().center();
    }

    public async mounted() {
        let config = this.$store.getters.configuration;
        const database = this.$store.getters.database as Database;

        config.load();
        if (!config.loaded()) {
            // If no config or not valid, redirect to config page
            return this.$router.push({name: 'config'});
        }

        let mameService = new MameService(config);
        let gameService = new GameService(config, mameService);

        if (!database.exist()) {
            // Create and fill database file if not existing
            await database.install(gameService);
        }

        // Save new games
        await gameService.saveGamesFromRomNames(mameService.getRomListFromFavorites());

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
