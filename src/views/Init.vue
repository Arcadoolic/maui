<template>
    <div></div>
</template>

<script lang="ts">
    import {Component, Vue} from 'vue-property-decorator';
    import * as remote from '@electron/remote';
    import Database from '@/class/Database.class';
    import User from '@/model/User.model';
    import {EventBus} from '@/EventBus';

    @Component
    export default class Init extends Vue {
        protected msg: string = 'Chargement';

        public created() {
            remote.getCurrentWindow().setResizable(true);
            remote.getCurrentWindow().setFullScreen(false);
            remote.getCurrentWindow().setSize(346, 354);
            remote.getCurrentWindow().center();
        }

        public async mounted() {
            const config = this.$store.getters.configuration;
            const database = this.$store.getters.database as Database;


            config.load();
            if (!config.loaded()) {
                // If no config or not valid, redirect to config page
                return this.$router.push({name: 'config'});
            }
            this.$store.commit('initServices');
            const mameService = this.$store.getters.mameService;
            const gameService = this.$store.getters.gameService;
            const userService = this.$store.getters.userService;
            const hiService = this.$store.getters.hiscoreService;

            if (!database.exist()) {
                // Create and fill database file if not existing
                await database.install(gameService);
            } else {
                await database.update();
            }

            // Save new games
            const romList = mameService.getRomListFromFavorites();
            await gameService.saveGamesFromRomNames(romList);

            await userService.loadUsers();
            hiService.saveHiscores(await gameService.loadGames()).then(() => {
                EventBus.$emit('hiscores-loaded');
            });

            this.$router.push({name: 'home'});
        }
    }
</script>

<style scoped>
    div {
        display: block;
        width: 100%;
        height: 100%;
        background-color: #000000;
        background-image: url(../assets/splash_screen_arcade.png);
        background-size: cover;
        background-repeat: repeat;
        background-position: 0 0;
    }
</style>
