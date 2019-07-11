<template>
    <div class="home">
        <div class="gameTitle" v-if="selectedGame">
            <h1>{{selectedGame.shortname}}</h1>
            <p>({{selectedGame.year}}, {{selectedGame.players}})</p>
        </div>
        <Games :games="games" :selectedGameIndex="selectedGameIndex"></Games>

        <div class="flyer-container">
            <transition name="flyer">
                <div class="flyer" v-if="flyer" :key="flyer"
                     :style="{backgroundImage: flyer ? 'url(' + flyer + ')' : false}"></div>
            </transition>
        </div>

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

    @Component({
        components: {
            Categories,
            Games,
            Hiscores,
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
        } = {};

        protected showHiscores: boolean = false;
        protected flyersPath: string = '';
        protected flyers: string [] = [];

        public async created() {
            if (!this.$store.getters.isInit) {
                return this.$router.push({name: 'init'});
            }

            remote.getCurrentWindow().setFullScreen(true);
            remote.getCurrentWindow().setResizable(true);

            const mameService = this.$store.getters.mameService;
            this.gameService = this.$store.getters.gameService;
            this.categories = await this.gameService.loadCategories();
            this.games = await this.gameService.loadGames();

            Gamepads.init();
            this.registerKeyMapping();

            this.flyersPath = mameService.flyerPath;
            this.flyers = this.gameService.loadFlyers();
        }

        protected registerKeyMapping() {
            this.onKeydown((e, isGamepad) => {
                const key = (isGamepad) ? (e as CustomEvent).detail.key : (e as KeyboardEvent).code;
                switch (key) {
                    case 'ArrowUp':
                        this.selectPreviousGame();
                        break;
                    case 'ArrowDown':
                        this.selectNextGame();
                        break;
                    case 'ArrowLeft':
                        this.selectPreviousCategory().then();
                        break;
                    case 'ArrowRight':
                        this.selectNextCategory().then();
                        break;
                    case 'Space':
                        this.showHiscores = !this.showHiscores;
                        this.timeouts.quit = window.setTimeout(() => remote.app.quit(), 3000);
                        break;
                    case 'Enter':
                        this.startGame();
                        break;

                }
            });

            this.onKeyup((e, isGamepad) => {
                const key = (isGamepad) ? (e as CustomEvent).detail.key : (e as KeyboardEvent).code;
                switch (key) {
                    case 'Space':
                        clearTimeout(this.timeouts.quit);
                        break;
                }
            });
        }

        protected selectPreviousGame() {
            this.selectedGameIndex = (this.selectedGameIndex <= 0) ? this.games.length - 1 : this.selectedGameIndex - 1;
        }

        protected selectNextGame() {
            this.selectedGameIndex = (this.selectedGameIndex >= this.games.length - 1) ? 0 : this.selectedGameIndex + 1;
        }

        protected async selectPreviousCategory() {
            this.selectedGameIndex = 0;
            this.selectedCategoryIndex = (this.selectedCategoryIndex <= 0) ?
                this.categories.length : this.selectedCategoryIndex - 1;
            if (this.selectedCategoryIndex === 0) {
                this.games = await this.gameService.loadGames();
            } else {
                this.games = await this.categories[this.selectedCategoryIndex - 1].$get('games') as Game[] || [];
            }
        }

        protected async selectNextCategory() {
            this.selectedGameIndex = 0;
            this.selectedCategoryIndex = (this.selectedCategoryIndex >= this.categories.length) ?
                0 : this.selectedCategoryIndex + 1;
            if (this.selectedCategoryIndex === 0) {
                this.games = await this.gameService.loadGames();
            } else {
                this.games = await this.categories[this.selectedCategoryIndex - 1].$get('games') as Game[] || [];
            }
        }

        protected get selectedGame() {
            return this.games[this.selectedGameIndex] || null;
        }

        protected get flyer() {
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
        }

        protected startGame() {
            const mameService = this.$store.getters.mameService;
            const hiService = this.$store.getters.hiscoreService;
            mameService.startGame(this.selectedGame.romName).then((gameProcess) => {
                gameProcess.on('close', async (e) => {
                    await hiService.saveHiscores(this.selectedGame);
                    EventBus.$emit('game-quit');
                });
            });
        }

        protected get isGameStarted() {
            const mameService = this.$store.getters.mameService;
            return mameService.isGameStarted;
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

    .gameTitle {
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

    .gameTitle > * {
        transform: rotateX(15deg) rotateY(0deg) rotateZ(0deg);
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
</style>
