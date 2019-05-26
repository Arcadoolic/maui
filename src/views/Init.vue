<template>
    <div></div>
</template>

<script lang="ts">
import {Component, Vue} from 'vue-property-decorator';
import {ipcRenderer, remote} from 'electron';
import {existsSync} from 'fs';
import GameService from '@/class/GameService.class';
import Config from '@/class/Config.class';
import {join} from 'path';

@Component
export default class Init extends Vue {
    protected msg: string = 'Chargement';

    public async mounted() {
        const userData = remote.app.getPath('userData');
        const config = this.$store.getters.configuration;
        const database = this.$store.getters.database;

        this.$store.commit('initLogger', join(
            (process.env.NODE_ENV === "development" ? '.' : userData),
            'mame-awesome-ui.log'
        ));
        const logger = this.$store.getters.logger;

        // Create and fill database file if not existing
        if (!database.exist()) {
            await database.install();
        }

        // Create and fill configuration file if not existing
        if (!config.exist()) {
            await this.installConfig();
        } else {
            config.load();
        }

        console.log('YEAH !');

        // Load games
    }

    protected async installConfig() {
        const config = this.$store.getters.configuration;
        if (!config.mameIniPath) {
            let mameIniDirPath: string[]|null = null;
            let mameIniPath = 'mame.ini';
            while (!mameIniDirPath || !mameIniDirPath.length || !existsSync(mameIniPath)) {
                await remote.dialog.showErrorBox('mame.ini not found !', 'mame.ini not found. Please select mame path.');
                mameIniDirPath = await remote.dialog.showOpenDialog({
                    title: 'Select mame.ini path',
                    properties: ['openDirectory', 'showHiddenFiles'],
                });
                if (mameIniDirPath[0]) {
                    mameIniPath = join(mameIniDirPath[0], 'mame.ini');
                }
            }
            config.mameIniPath = mameIniPath;
            config.save();
        }
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
