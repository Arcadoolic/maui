<template>
    <span>
        <div class="gameTitle" v-if="selectedGame">
            <h1>{{selectedGame.shortname}}</h1>
            <p>({{selectedGame.year}}, {{selectedGame.nplayerString}})</p>
        </div>

        <Games :selectedCategory="selectedCategory" @gameChange="gameChange"></Games>
        <Categories @categoryChange="categoryChange"></Categories>
        <GamepadsComponent></GamepadsComponent>
    </span>
    <!--<button v-if="mame.isGameOn" @click.prevent="mame.stop()">Kill</button>-->

</template>

<script lang="ts">
import {Vue, Component} from 'vue-property-decorator';
import GameList from '@/class/GameList.class';
import Categories from '@/components/Categories.vue';
import Mame from '@/class/Mame.class';
import GameCategory from '@/class/GameCategory.class';
import Games from '@/components/Games.vue';
import Game from '@/class/Game.class';
import ControllerMappingJson from '../assets/controllers.json';
import Gamepads from '@/class/Gamepads.class';
import GamepadsComponent from '@/components/Gamepads.vue';

@Component({
    components: {
        Categories,
        Games,
        GamepadsComponent,
    },
})
export default class Home extends Vue {
    protected gameList = new GameList();
    protected mame = new Mame();
    protected selectedCategory: GameCategory|null = null;
    protected selectedGameId: number = 0;
    protected selectedGame: Game|null = null;

    public created() {
        this.gameList = this.$store.getters.gameList;
        this.mame = this.$store.getters.mame;
        this.selectedCategory = this.gameList.getCategories()[0]; // Category ALL
        this.selectedGame = this.selectedCategory.getGames()[0];
        Gamepads.init();
    }

    /**
     * Called when categoryChange event is triggered on Categories component
     * @param categoryId
     */
    protected categoryChange(categoryId: number) {
        this.selectedCategory = this.gameList.getCategories()[categoryId];
    }

    /**
     * Called when gameChange event is triggered on Games component
     * @param gameId
     */
    protected gameChange(gameId: number) {
        this.selectedGameId = gameId;
        this.selectedGame = this.selectedCategory!.getGames()[gameId];
    }
}
</script>

<style scoped>
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
        .gameTitle h1 {
            transform: rotateX(15deg) rotateY(0deg) rotateZ(0deg);
        }
        .gameTitle p {
            line-height: 3em;
            font-size: 1vw;
            color: #fff513;
            text-shadow:
                0 0 30px rgba(237, 106, 10, 0.8),
                0 2px 0 rgb(255, 81, 0),
                0 4px 20px rgba(255, 81, 0, 0.5),
                0 6px 3px rgba(242, 0, 10, 0.7),
                0 12px 16px rgba(0, 0, 0, 1),
                6px 12px 9px rgba(0, 0, 0, 1);
            transform: rotateX(15deg) rotateY(0deg) rotateZ(0deg);
        }
</style>
