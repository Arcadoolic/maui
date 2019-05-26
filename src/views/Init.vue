<template>
    <div></div>
</template>

<script lang="ts">
import {Component, Vue} from 'vue-property-decorator';
import {ipcRenderer, remote} from 'electron';
import Config from '@/class/Config.class';
import {join} from 'path';
import MameService from "@/class/MameService.class";

@Component
export default class Init extends Vue {
    protected msg: string = 'Chargement';

    public created() {
        remote.getCurrentWindow().setSize(346, 354);
        remote.getCurrentWindow().center();
    }

    public async mounted() {
        let config = this.$store.getters.configuration;
        const database = this.$store.getters.database;

        config.load();
        if (!config.loaded()) {
            // If no config or not valid, redirect to config page
            return this.$router.push({name: 'config'});
        }

        if (!database.exist()) {
            // Create and fill database file if not existing
            await database.install();
        }

        let mameService = new MameService(config.mamePath);
        console.log(mameService.getRomListFromFavorites());

        // TODO : Check if mame installed first
        // If can't execute command mame ask for mame binary path
        // Once ok,  execute commande `mame -showconfig` and extract needed information like "home", "inipath" and "rompath"
        // Attention : Multiple bin names (mame.exe, mame64.exe, ...)

        // Toujours executer mame depuis son homepath ! si "." utiliser le path du binaire
        const regex = /^(homepath|rompath|inipath)\s*(.*)$/;

        // Load games

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
