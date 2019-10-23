<template>
    <div class="home">
        <modal v-if="showLoader">
            <p>{{loaderTitle}}</p>
            <loader :duration="loaderDuration"></loader>
        </modal>


        <user-registration v-if="showAddUser" @quit="showAddUser = false"></user-registration>

        <transition name="title">
            <div class="gameTitle" v-if="selectedGame" v-show="showTitle">
                <h1>{{selectedGame.shortname}}</h1>
                <p>({{selectedGame.year}}, {{selectedGame.players}})</p>
            </div>
        </transition>

        <transition name="category">
            <div class="categoryTitle" v-show="showTitle">
                <h1>{{category.name}}</h1>
            </div>
        </transition>

        <transition name="games">
            <Games :games="games" :selectedGameIndex="selectedGameIndex" v-show="showGames"></Games>
        </transition>

        <transition name="flyer">
            <div class="flyer-container" v-show="showFlyer">
                <div class="flyer" v-if="flyer" :style="{backgroundImage: flyer ? 'url(' + flyer + ')' : false}"></div>
            </div>
        </transition>

        <Categories :categories="categories" :selectedCategoryIndex="selectedCategoryIndex"></Categories>

        <transition name="slide">
            <Hiscores :game="selectedGame" v-if="selectedGame && selectedGame.hi && showHiscores"></Hiscores>
        </transition>
    </div>

</template>

<script lang="ts">
    import {Component} from 'vue-property-decorator';
    import Categories from '@/components/Categories.vue';
    import Games from '@/components/Games.vue';
    import Gamepads from '@/class/Gamepads.class';
    import Hiscores from '@/components/Hiscores.vue';
    import ControllableVue from '@/ControllableVue';
    import {remote} from 'electron';
    import Game from '@/model/Game.model';
    import Category from '@/model/Category.model';
    import {join} from 'path';
    import {format} from 'url';
    import {EventBus} from '@/EventBus';
    import GameService from '@/class/GameService.class';
    import * as Log from 'electron-log';
    import UserRegistration from "@/components/userRegistration.vue";
    import Loader from "@/components/Loader.vue";
    import Modal from "@/components/Modal.vue";

    @Component({
        components: {
            Categories,
            Games,
            Hiscores,
            UserRegistration,
            Loader,
            Modal
        },
    })
    export default class Home extends ControllableVue {
        protected gameService!: GameService;
        protected games: Game[] = [];
        protected selectedGameIndex: number = 0;

        protected categories: Category[] = [];
        protected selectedCategoryIndex: number = 0;

        protected timeouts: {
            quit?: number,
            showGame?: number,
            showFlyer?: number,
            addPlayer?: number,
        } = {};

        protected showHiscores: boolean = false;
        protected flyersPath: string = '';
        protected flyers: string [] = [];
        protected flyer: string = '';

        protected showGames: boolean = true;
        protected showTitle: boolean = true;
        protected showFlyer: boolean = true;
        protected showLoader: boolean = false;
        protected showAddUser: boolean = false;

        protected loaderDuration: number = 2;
        protected loaderTitle: string = 'Button pressing';

        public async created() {
            if (!this.$store.getters.isInit) {
                return this.$router.push({name: 'init'});
            }

            if (process.env.NODE_ENV !== 'development') {
                remote.getCurrentWindow().setFullScreen(true);
            }

            const mameService = this.$store.getters.mameService;
            this.gameService = this.$store.getters.gameService;
            this.categories = await this.gameService.loadCategories();
            this.games = await this.gameService.loadGames();

            Gamepads.init();
            this.registerKeyMapping();

            this.flyersPath = mameService.flyerPath;
            this.flyers = this.gameService.loadFlyers();
            this.flyer = this.generateFlyerPath();
        }

        public mounted() {
            if (process.env.NODE_ENV !== 'development') {
                remote.getCurrentWindow().setFullScreen(true);
            }
        }

        protected registerKeyMapping() {
            this.onKeydown((e, isGamepad) => {
                if (this.showAddUser) {
                    return;
                }
                const key = (isGamepad) ? (e as CustomEvent).detail.key : (e as KeyboardEvent).code;
                switch (key) {
                    case 'ArrowUp':
                        this.onGameChange(true);
                        break;
                    case 'ArrowDown':
                        this.onGameChange(false);
                        break;
                    case 'ArrowLeft':
                        this.onCategoryChange(true);
                        break;
                    case 'ArrowRight':
                        this.onCategoryChange(false);
                        break;
                    case 'Space':
                        this.showHiscores = !this.showHiscores;
                        this.timeouts.quit = window.setTimeout(() => remote.app.quit(), 3000);
                        break;
                    case 'Enter':
                        this.startGame();
                        break;
                    case 'KeyP':
                        this.addPlayer();
                        break;

                }
            });

            this.onKeyup((e, isGamepad) => {
                if (this.showAddUser) {
                    return;
                }
                const key = (isGamepad) ? (e as CustomEvent).detail.key : (e as KeyboardEvent).code;
                switch (key) {
                    case 'Space':
                        clearTimeout(this.timeouts.quit);
                        break;
                    case 'KeyP':
                        this.showLoader = false;
                        clearTimeout(this.timeouts.addPlayer);
                        break;
                }
            });
        }

        protected onGameChange(previous: boolean) {
            const showFlyerFn = () => {
                this.flyer = this.generateFlyerPath();
                this.showFlyer = true;
            };
            this.showFlyer = false;
            clearTimeout(this.timeouts.showFlyer);
            this.timeouts.showFlyer = window.setTimeout(showFlyerFn, 300);
            this.selectedGameIndex = previous ?
                ((this.selectedGameIndex <= 0) ? this.games.length - 1 : this.selectedGameIndex - 1) :
                ((this.selectedGameIndex >= this.games.length - 1) ? 0 : this.selectedGameIndex + 1);
        }

        protected onCategoryChange(previous: boolean) {
            const showGameFn = async () => {
                // Load games
                this.games = (!this.selectedCategoryIndex) ? await this.gameService.loadGames() :
                    await this.categories[this.selectedCategoryIndex - 1].$get('games') as Game[] || [];

                this.selectedGameIndex = 0;
                this.flyer = this.generateFlyerPath();

                this.showGames = true;
                this.showTitle = true;
                this.showFlyer = true;
            };
            this.showHiscores = false;
            this.showTitle = false;
            this.showFlyer = false;
            this.showGames = false;
            clearTimeout(this.timeouts.showGame); // Clear timeout if already exist
            this.timeouts.showGame = window.setTimeout(showGameFn, 300); // In 300, execute all logic and show everyt
            this.selectedCategoryIndex = previous ?
                ((this.selectedCategoryIndex <= 0) ? this.categories.length : this.selectedCategoryIndex - 1) :
                ((this.selectedCategoryIndex >= this.categories.length) ? 0 : this.selectedCategoryIndex + 1);
        }

        protected get selectedGame() {
            return this.games[this.selectedGameIndex] || null;
        }

        protected generateFlyerPath(): string {
            if (this.selectedGame) {
                const i = this.flyers.indexOf(this.selectedGame.romName + '.png');
                const path = i < 0 ? null : join(this.flyersPath, this.flyers[i]);
                if (!path) {
                    return '';
                }
                return format({
                    pathname: path,
                    protocol: 'file',
                    slashes: true,
                });
            }
            return '';
        }

        protected startGame() {
            const mameService = this.$store.getters.mameService;
            const hiService = this.$store.getters.hiscoreService;
            mameService.startGame(this.selectedGame.romName).then(
                (gameProcess) => {
                    gameProcess.on('close', (e) => {
                        hiService.saveHiscores(this.selectedGame).then(() => {
                            EventBus.$emit('game-quit');
                        });
                    });
                },
                (error) => {
                    Log.error('[Home] Error on game ' + this.selectedGame.id_game + ' launch.');
                    Log.error(error);
                }
            );
        }

        protected get isGameStarted() {
            const mameService = this.$store.getters.mameService;
            return mameService.isGameStarted;
        }

        protected addPlayer() {
            this.loaderDuration = 2;
            this.showLoader = true;
            this.loaderTitle = 'Add new player ?';
            this.timeouts.addPlayer = window.setTimeout(() => {
                this.showLoader = false;
                this.showAddUser = true;
            }, 2000)
        }

        protected get category() {
            if (this.selectedCategoryIndex) {
                return this.categories[this.selectedCategoryIndex - 1];
            }
            return {name: 'All Games'};
        }
    }
</script>

<style scoped>
    .home {
        display: block;
        width: 100%;
        height: 100%;
        background-color: #000000;
        background-image: url(../assets/background.jpg);
        background-size: cover;
        background-repeat: repeat;
        background-position: 0 0;
    }

    .gameTitle, .categoryTitle {
        position: absolute;
        width: 100%;
        z-index: 2;
        text-align: center;
        background: linear-gradient(to bottom, rgb(35, 10, 0) -30%, rgba(0, 0, 0, 0.3) 70%, transparent 100%);
        color: #fff513;
        font-size: 2.5vw; /*45px;*/
        padding: 26px;
        font-family: 'Arcade_I', sans-serif;
        perspective: 460px;
        perspective-origin: 50% 50%;
        text-shadow: 0 0 30px rgba(237, 106, 10, 0.8),
        0 3px 0 rgb(255, 81, 0),
        0 5px 20px rgba(255, 81, 0, 0.5),
        0 6px 5px rgba(242, 0, 10, 0.7),
        0 12px 16px rgba(0, 0, 0, 1),
        6px 12px 9px rgba(0, 0, 0, 1);
        filter: saturate(1.3);
    }
    .categoryTitle {
        bottom: 10px;
        background: none;
    }

    .gameTitle > * {
        transform: rotateX(15deg) rotateY(0deg) rotateZ(0deg);
    }

    .categoryTitle > * {
        font-size: 0.5em;
    }

    .gameTitle p {
        line-height: 3em;
        font-size: 1vw;
    }

    .slide-leave-active {
        transition: margin-bottom .3s ease-in 0s;
    }

    .slide-enter-active {
        transition: margin-bottom .3s ease-out 0s;
    }

    .slide-enter, .slide-leave-to {
        margin-bottom: -100%;
    }

    .flyer-container {
        position: absolute;
        right: -3%;
        top: -5%;
        bottom: -5%;
        width: 40%;
    }

    .flyer {
        width: 100%;
        height: 100%;
        transform: rotateZ(-4deg);
        background-repeat: no-repeat;
        background-size: cover;
    }

    .flyer-enter, .flyer-leave-to {
        margin-right: -100%;
    }

    .games-enter, .games-leave-to {
        margin-left: -100%;
    }

    .flyer-leave-active, .games-leave-active, .title-leave-active, .category-leave-active {
        transition: all .3s ease-in 0s;
    }

    .flyer-enter-active, .games-enter-active, .title-enter-active, .category-enter-active {
        transition: all .3s ease-out 0s;
    }

    .title-enter, .title-leave-to {
        margin-top: -100%;
    }

    .category.enter, .category-leave-to {
        margin-bottom: -100%;
    }

    loader {
        position: absolute;
        top: 10%;
        left: 50%;
    }
</style>
