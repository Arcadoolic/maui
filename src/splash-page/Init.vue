<template>
    <div></div>
</template>

<script lang="ts">
import {Component, Vue} from 'vue-property-decorator';
import {ipcRenderer, remote} from 'electron';
import {existsSync} from 'fs';
import GameService from '@/class/GameService.class';
import Config from '@/class/Config.class';
import HiscoreService from '@/class/HiscoreService.class';
import Players from '@/class/Players.class';
import IPDDatabase from '@/class/IPDDatabase.class';
import {appendFileSync} from 'fs';
import {Sequelize} from 'sequelize-typescript';
import Category from '@/model/Category.model';
import Game from '@/model/Game.model';
import GameHistoryModel from '@/model/GameHistory.model';
import User from '@/model/User.model';
import {join} from 'path';

@Component
export default class Init extends Vue {
    protected msg: string = 'Chargement';

    public async mounted() {
        const userData = remote.app.getPath('userData');
        const databasePath = join(
            (process.env.NODE_ENV === "development" ? '.' : userData),
            'mame-awesome-ui.sqlite'
        );
        const configPath = join(
            (process.env.NODE_ENV === "development" ? '.' : userData),
            'mame-awesome-ui-config.json'
        );

        remote.dialog.showOpenDialog({ properties: ['openDirectory'] });

        this.$store.commit('initLogger', join(
            (process.env.NODE_ENV === "development" ? '.' : userData),
            'mame-awesome-ui.log'
        ));
        const logger = this.$store.getters.logger;

        // Database connexion
        this.$store.commit('setDatabase', new Sequelize({
            dialect: 'sqlite',
            storage: databasePath,
            models: [Category],
        }));

        if (!existsSync(databasePath)) {
            await this.installDatabase();
        }
        // if (!existsSync(configPath)) {
        //     await this.installConfig();
        // }

        // Load games
    }

    /**
     * Init database
     */
    protected async installDatabase() {
        const db = this.$store.getters.database;
        await db.sync();

        // Create categories
        await Category.bulkCreate([
            {name: 'Ball & Paddle'},
            {name: 'Board Game'},
            {name: 'Calculator'},
            {name: 'Casino'},
            {name: 'Climbing'},
            {name: 'Coin Pusher'},
            {name: 'Computer'},
            {name: 'Driving'},
            {name: 'Electromechanical'},
            {name: 'Fighter'},
            {name: 'Game Console'},
            {name: 'Handheld'},
            {name: 'Maze'},
            {name: 'Medal Game'},
            {name: 'Medical Equipment'},
            {name: 'Misc.'},
            {name: 'MultiGame'},
            {name: 'Multiplay'},
            {name: 'Music'},
            {name: 'Platform'},
            {name: 'Printer'},
            {name: 'Puzzle'},
            {name: 'Quiz'},
            {name: 'Rhythm'},
            {name: 'Shooter'},
            {name: 'Slot Machine'},
            {name: 'Sports'},
            {name: 'System'},
            {name: 'Tabletop'},
            {name: 'Telephone'},
            {name: 'Utilities'},
            {name: 'Whac-A-Mole'},
        ]);
    }

    protected installConfig() {
        const config = this.$store.getters.configuration;

        if (!config.mameIniPath) {
            remote.dialog.showOpenDialog({ properties: ['openDirectory'] })
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
