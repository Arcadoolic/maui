<template>
    <span>
        <div class="gameTitle">
            <h1>{{selectedGame.shortname}}</h1>
            <small>({{selectedGame.year}}, {{selectedGame.nplayerString}})</small>
        </div>

        <div class="gamesContainer">
            <div class="selectedGameBackground"></div>
            <div class="games">
                <ul ref="gameList">
                    <li v-for="(game, index) in gameFromCurrentCategory" :class="{selected: selectedGameId == index}">
                        <div class="marquee"
                             :style="{marginLeft: Math.max(9 - Math.abs(selectedGameId - index), 0) + '%'}"
                        ></div>
                    </li>

                    <!--<li v-for="(game, index) in gameFromCurrentCategory"-->
                        <!--class="slider-jeux__jeu slider-jeux__jeu&#45;&#45;non-actif"-->
                    <!--&gt;-->
                        <!--<div class="slider-jeux__marquee" style="background-image: url(../assets/default_marquee.jpg)">-->
                            <!--<div class="slider-jeux__voile-marquee"></div>-->
                        <!--</div>-->
                    <!--</li>-->
                </ul>
            </div>
        </div>
        <p style="position: absolute; right: 10px; top: 10px; font-size: 30px; color: white">{{selectedGameId}}</p>
    </span>


        <!--<ul :class="{hovered: verticalSelect === 1}" class="games">-->
            <!--<li v-for="(game, index) in gameFromCurrentCategory"-->
                <!--:class="{selected: gameSelected === index}">{{game.fullname}}-->
            <!--</li>-->
        <!--</ul>-->

        <!--<button v-if="mame.isGameOn" @click.prevent="mame.stop()">Kill</button>-->

        <!--<Categories :class="{hovered: verticalSelect === 2}"></Categories>-->
</template>

<script lang="ts">
import {Vue, Component, Prop, Watch} from 'vue-property-decorator';
import GameList from '../class/GameList.class';
import Categories from '@/components/Categories.vue';
import Mame from '@/class/Mame.class';

@Component({
    components: {
        Categories,
    },
})
export default class Home extends Vue {
    protected blockVerticalSelect = true;

    protected gameList = new GameList();
    protected categorySelected = 0;

    protected selectedGameId = 0;

    @Prop({required: true, default: 0})
    protected verticalSelect?: number;

    protected mame = new Mame();

    public created() {
        this.gameList = this.$store.getters.gameList;

        window.addEventListener('keydown', (e) => {
            if (e.code === 'Enter') {
                if (this.verticalSelect === 1) {
                    if (this.blockVerticalSelect) {
                        if (this.gameFromCurrentCategory[this.selectedGameId]) {
                            this.mame.start(this.gameFromCurrentCategory[this.selectedGameId]);
                        }
                    }
                    this.blockVerticalSelect = !this.blockVerticalSelect;
                    this.$emit('blockVerticalSelect', this.blockVerticalSelect);
                }
            } else if (e.code === 'Escape') {
                if (this.verticalSelect === 1) {
                    this.blockVerticalSelect = false;
                    this.$emit('blockVerticalSelect', false);
                }
            } else if (e.code === 'ArrowLeft') {
                if (this.verticalSelect === 2 || (this.verticalSelect === 1 && this.blockVerticalSelect)) {
                    this.selectedGameId = 0;
                    this.categorySelected--;
                }
            } else if (e.code === 'ArrowRight') {
                if (this.verticalSelect === 2 || (this.verticalSelect === 1 && this.blockVerticalSelect)) {
                    this.selectedGameId = 0;
                    this.categorySelected++;
                }
            } else if (e.code === 'ArrowUp') {
                if (this.blockVerticalSelect) {
                    this.selectedGameId = this.selectedGameId <= 0
                        ? this.gameFromCurrentCategory.length - 1
                        : this.selectedGameId - 1;
                }
            } else if (e.code === 'ArrowDown') {
                if (this.blockVerticalSelect) {
                    this.selectedGameId = this.selectedGameId >= this.gameFromCurrentCategory.length - 1
                        ? 0
                        : this.selectedGameId + 1;
                }
            }
        });
    }

    @Watch('selectedGameId')
    protected a() {
        (this.$refs.gameList as HTMLElement).style.top = (-10 * this.selectedGameId) + '%';
    }

    /**
     *
     */
    public get gameFromCurrentCategory() {
        return this.gameList.getCategories()[0].getGames();
    }

    public get selectedGame() {
        return this.gameFromCurrentCategory[this.selectedGameId];
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
        font-size: 45px;
        padding: 26px;
        line-height: 1.2;
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
        transform: rotateX(15deg) rotateY(0deg) rotateZ(0deg);
        filter: saturate(1.3);
    }
        .gameTitle small {
            font-size: .5em;
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

    .gamesContainer{
        width: 100%;
        height: 100%;
        overflow: hidden;
        position: relative;
        /*z-index: 12;*/
        filter: saturate(2);
    }

    .selectedGameBackground {
        position: absolute;
        left: 0;
        top: 35%;
        background: linear-gradient(to right, rgba(0, 30, 255, 0.25) 50%, transparent);
        height: 30%;
        width: 50%;
    }

    .games {
        position: relative;
        top: 35%;
        height: 65%;
        /*border: 1px solid red;*/
        width: 50%;
    }
        .games ul {
            position: absolute;
            top: 0;
            right: 0;
            left: 0;
            width: 100%;
            height: 100%;
            /*border: 1px solid yellow;*/
            overflow: visible;
            transition: top 0.3s ease;
        }

        .games ul li {
            display: flex;
            height: 10%;
            width: 100%;
            /*border: 1px solid green;*/
            position: relative;
            align-items: center;
        }
        .games ul li.selected {
            height: 46%;
            top: 0;
        }

        .games .marquee {
            margin-left: 10%;
            display: inline-block;
            width: 35%;
            height: 90%;
            background-repeat: no-repeat;
            background-image: url(../assets/default_marquee.jpg);
            background-size: cover;
            background-position: center;
            border-radius: 5px;
            box-shadow: 0 0 30px #000000;
            transition: height 0.3s ease, width 0.3s ease, margin-left 0.3s ease;
        }
            .games ul li.selected .marquee {
                width: 100%;
                height: 80%;
            }
</style>
