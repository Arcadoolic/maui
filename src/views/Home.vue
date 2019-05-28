<template>
    <div class="home">
        <div class="gameTitle" v-if="selectedGame">
            <h1>{{selectedGame.shortname}}</h1>
            <p>({{selectedGame.year}}, {{selectedGame.players}})</p>
        </div>
        <Games :games="games" :selectedGameIndex="selectedGameIndex"></Games>
        <Categories :categories="categories" :selectedCategoryIndex="selectedCategoryIndex"></Categories>
<!--        <GamepadsComponent></GamepadsComponent>-->

<!--        <transition name="slide">-->
<!--            <Hiscores :game="selectedGame" v-if="selectedGame.hasHiscore && showHiscores"></Hiscores>-->
<!--        </transition>-->
    </div>
    <!--<button v-if="mame.isGameOn" @click.prevent="mame.stop()">Kill</button>-->

</template>

<script lang="ts">
import {Component} from 'vue-property-decorator';
import GameList from '@/class/GameList.class';
import Categories from '@/components/Categories.vue';
import Mame from '@/class/Mame.class';
import GameCategory from '@/class/GameCategory.class';
import Games from '@/components/Games.vue';
import Gamepads from '@/class/Gamepads.class';
import GamepadsComponent from '@/components/Gamepads.vue';
import Hiscores from '@/components/Hiscores.vue';
import ControllableVue from '@/ControllableVue';
import {remote} from 'electron';
import Game from '@/model/Game.model';
import Category from "@/model/Category.model";

@Component({
    components: {
        Categories,
        Games,
    },
})
export default class Home extends ControllableVue {
    protected games: Game[] = [];
    protected selectedGameIndex: number = 0;

    protected categories: Category[] = [];
    protected selectedCategoryIndex: number = 0;

    protected timeouts: {
        quit?: number
    } = {};
    // protected gameList = new GameList();
    // protected mame = new Mame();
    // protected selectedCategory: GameCategory|null = null;
    // protected selectedGameId: number = 0;
    // protected showHiscores: boolean = false;
    // protected closeTimeout: any = 0;

    public async created() {
        if (!this.$store.getters.isInit) {
            return this.$router.push({name: 'init'});
        }

        // remote.getCurrentWindow().setFullScreen(true);
        remote.getCurrentWindow().setResizable(true);

        const gameService = this.$store.getters.gameService;
        this.games = await gameService.loadGames();
        this.categories = await gameService.loadCategories();

        Gamepads.init();
        this.registerKeyMapping();

        // this.gameList = this.$store.getters.gameList;
        // this.mame = this.$store.getters.mame;
        // this.selectedCategory = this.gameList.getCategories()[0]; // Category ALL
        // this.selectedGame = this.selectedCategory.getGames()[0];
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
                    this.selectPreviousCategory();
                    break;
                case 'ArrowRight':
                    this.selectNextCategory();
                    break;
                case 'Space':
                    this.timeouts.quit = window.setTimeout(() => remote.app.quit(), 3000);
                    break;

            }
        });

        this.onKeyup((e, isGamepad) => {
            const key = (isGamepad) ? (e as CustomEvent).detail.key : (e as KeyboardEvent).code;
            switch (key) {
                case 'Space':
                    clearTimeout(this.timeouts.quit);
                    break
            }
        })
    }

    protected selectPreviousGame() {
        this.selectedGameIndex = (this.selectedGameIndex <= 0) ? this.games.length - 1 : this.selectedGameIndex - 1;
    }
    protected selectNextGame() {
        this.selectedGameIndex = (this.selectedGameIndex >= this.games.length -1) ? 0 : this.selectedGameIndex + 1;
    }

    protected selectPreviousCategory() {
        this.selectedCategoryIndex = (this.selectedCategoryIndex <= 0) ? this.categories.length - 1 : this.selectedCategoryIndex - 1;
    }
    protected selectNextCategory() {
        this.selectedCategoryIndex = (this.selectedCategoryIndex >= this.categories.length -1) ? 0 : this.selectedCategoryIndex + 1;
    }

    protected get selectedGame() {
        return this.games[this.selectedGameIndex] || null;
    }

    /**
     * Called when categoryChange event is triggered on Categories component
     * @param categoryId
     */
    // protected categoryChange(categoryId: number) {
    //     this.selectedCategory = this.gameList.getCategories()[categoryId];
    //     this.showHiscores = false;
    // }

    /**
     * Called when gameChange event is triggered on Games component
     * @param gameId
     */
    // protected gameChange(gameId: number) {
    //     this.selectedGameId = gameId;
    //     this.selectedGame = this.selectedCategory!.getGames()[gameId];
    // }
}
</script>

<style scoped>
    .home {
        display: block;
        width: 100%;
        height: 100%;
        background-color: #000000;
        background-image:  url(../assets/background.jpg);
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
        font-size: 2.5vw;/*45px;*/
        padding: 26px;
        font-family: 'Arcade_I', sans-serif;
        perspective: 460px;
        perspective-origin: 50% 50%;
        text-shadow:
            0 0 30px rgba(237, 106, 10, 0.8),
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

    .slide-enter, .slide-leave-to{
        margin-bottom: -100%;
    }
</style>
