<template>
    <div></div>
</template>

<script lang="ts">
    import {Component, Vue} from 'vue-property-decorator';
    import {remote} from 'electron';
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
            }

            // Save new games
            // Create user for tests
            await User.bulkCreate([
                    {pseudo_3: 'NOB', realname: 'Bruno', email: 'bteffot@infopro-digital.com'},
                    {pseudo_3: 'ALN', realname: 'Adrien Landon', email: 'alandon@infopro-digital.com'},
                    {pseudo_3: 'PHP', realname: 'Pierre-Hugues PERET', email: 'phperet@infopro-digital.com'},
                    {pseudo_3: 'ZEL', realname: 'Fabien Viallard', email: 'fviallard@infopro-digital.com'},
                    {pseudo_3: 'GRE', realname: 'Grégory AUBERTIN', email: 'gaubertin@infopro-digital.com'},
                    {pseudo_3: 'GUS', realname: 'Gustavo Marin', email: 'gmarin@infopro-digital.com'},
                    {pseudo_3: 'BEN', realname: 'Ben', email: 'bjdelplancke@infopro-digital.com'},
                    {pseudo_3: 'NIP', realname: 'Nicolas Pierlet', email: 'npierlet@infopro-digital.com'},
                    {pseudo_3: 'MJO', realname: 'Marie-Jocelyne Nguyen', email: 'mjnguyen@infopro-digital.com'},
                    {pseudo_3: 'LOY', realname: 'Loyce LEICHNIG', email: 'lleichnig@infopro-digital.com'},
                    {pseudo_3: 'DID', realname: 'Didier', email: 'dcadet@infopro-digital.com'},
                    {pseudo_3: 'SEB', realname: 'Sébastien TRATAPEL', email: 'stratapel@infopro-digital.com'},
                    {pseudo_3: 'SKI', realname: 'Cédric Pasminski', email: 'cpasminski@infopro-digital.com'},
                    {pseudo_3: 'LOL', realname: 'Laurent MINOST', email: 'lminost@infopro-digital.com'},
                    {pseudo_3: 'RAZ', realname: 'Romain Azevedo', email: 'razevedo@infopro-digital.com'},
                    {pseudo_3: 'ROM', realname: 'is ROM', email: 'rom@rom.com'},
                    {pseudo_3: 'SAJ', realname: 'Chief Sajid', email: 'sajidf@gmail.com'},
                    {pseudo_3: 'NSP', realname: 'NSPIRIT', email: 'pmercier@infopro-digital.com'},
                    {pseudo_3: 'FM', realname: 'Fred', email: 'merad.frederic@gmail.com'},
                    {pseudo_3: 'TIP', realname: 'Thibault Peauger', email: 'tpeauger@infopro-digital.com'},
                    {pseudo_3: 'MYK', realname: 'Michael Lorquin', email: 'michaellorquin@gmail.com'},
                    {pseudo_3: 'LOI', realname: 'LEFEVRE Loic', email: 'llefevre@infopro-digital.com'},
                    {pseudo_3: 'EG', realname: 'erwan gannat', email: 'egannat@infopro-digital.com'},
                    {pseudo_3: 'FRN', realname: 'Frédéric Nguyen', email: 'fnguyen.pro@gmail.com'},
                    {pseudo_3: 'MCH', realname: 'Mohamed CHAABANE', email: 'chaabane.mohamed0@gmail.com'},
                    {pseudo_3: 'JUL', realname: 'Julien Peauger', email: 'jpeauger@infopro-digital.com'},
                    {pseudo_3: 'JOE', realname: 'Johann', email: 'jguillou@infopro-digital.com'},
                    {pseudo_3: 'PYV', realname: 'Pierre-Yves Vignau', email: 'pyvignau@infopro-digital.com'},
                    {pseudo_3: 'SNO', realname: 'Tristan Payen', email: 'tristan.payen@infopro-digital.com'},
                    {pseudo_3: 'MAN', realname: 'Emmanuel Joseph', email: 'emmanuel.joseph@infopro-digital.com'},
                    {pseudo_3: 'FLO', realname: 'Florent Massiera', email: 'florent.massiera@infopro-digital.com'},
                    {pseudo_3: 'BGE', realname: 'Benoit Geffrotin', email: 'benoit.geffrotin@infopro-digital.com'},
                    {pseudo_3: 'MEH', realname: 'Medour Mehdi', email: 'mmedour@companeo.com'},
                    {pseudo_3: 'MAY', realname: 'Sandrine MOUSSAC', email: 'sandrine.moussac@infopro-digital.com'},
                    {pseudo_3: 'MLS', realname: 'Mickaël Louis-Sidney', email: 'Mickael.LOUIS-SIDNEY@infopro-digital.com'},
                    {pseudo_3: 'MAF', realname: 'Henri Andriamaholy', email: 'henri.andriamaholy@infopro-digital.com'},
                    {
                        pseudo_3: 'JBJ',
                        realname: 'Jean-Baptiste Jouannaud',
                        email: 'Jean-Baptiste.JOUANNAUD@infopro-digital.com',
                    },
                    {pseudo_3: 'ATN', realname: 'Anh-Tuan NGUYEN', email: 'anh-tuan.nguyen@infopro-digital.com'},
                ], {ignoreDuplicates: true},
            );
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
