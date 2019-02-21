<template>
    <div class="slider-jeux filter-saturate-140">
        <ul class="slider-jeux__cont">
            <li v-for="(game, index) in gameFromCurrentCategory"
                class="slider-jeux__jeu slider-jeux__jeu--non-actif"
            >
                <div class="slider-jeux__marquee" style="background-image: url(../assets/default_marquee.jpg)">
                    <div class="slider-jeux__voile-marquee"></div>
                </div>
            </li>
        </ul>
    </div>

        <!--<ul :class="{hovered: verticalSelect === 1}" class="games">-->
            <!--<li v-for="(game, index) in gameFromCurrentCategory"-->
                <!--:class="{selected: gameSelected === index}">{{game.fullname}}-->
            <!--</li>-->
        <!--</ul>-->

        <!--<button v-if="mame.isGameOn" @click.prevent="mame.stop()">Kill</button>-->

        <!--<Categories :class="{hovered: verticalSelect === 2}"></Categories>-->
</template>

<script lang="ts">
import {Vue, Component, Prop} from 'vue-property-decorator';
import GameList from '../class/GameList.class';
import Categories from '@/components/Categories.vue';
import Mame from '@/class/Mame.class';

@Component({
    components: {
        Categories,
    },
})
export default class Home extends Vue {
    protected blockVerticalSelect = false;

    protected gameList = new GameList();
    protected categorySelected = 0;

    protected gameSelected = 0;

    @Prop({required: true, default: 0})
    protected verticalSelect?: number;

    protected mame = new Mame();

    public created() {
        this.gameList = this.$store.getters.gameList;

        window.addEventListener('keyup', (e) => {
            if (e.code === 'Enter') {
                if (this.verticalSelect === 1) {
                    if (this.blockVerticalSelect) {
                        if (this.gameFromCurrentCategory[this.gameSelected]) {
                            this.mame.start(this.gameFromCurrentCategory[this.gameSelected]);
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
                    this.gameSelected = 0;
                    this.categorySelected--;
                }
            } else if (e.code === 'ArrowRight') {
                if (this.verticalSelect === 2 || (this.verticalSelect === 1 && this.blockVerticalSelect)) {
                    this.gameSelected = 0;
                    this.categorySelected++;
                }
            } else if (e.code === 'ArrowUp') {
                if (this.blockVerticalSelect) {
                    this.gameSelected--;
                }
            } else if (e.code === 'ArrowDown') {
                if (this.blockVerticalSelect) {
                    this.gameSelected++;
                }
            }
        });
    }

    /**
     *
     */
    public get gameFromCurrentCategory() {
        return this.gameList.getCategories()[this.categorySelected].getGames();
    }

    public moveVertical() {
        console.log('moveVertical');
    }
}
</script>

<style scoped>
    /**********************************************/
    /*///////////// SLIDER DES JEUX //////////////*/
    /**********************************************/
    .slider-jeux{
        overflow: hidden;
        position: relative;
        width: 100%;
        z-index: 12;
    }

    /*_______ Fond de couleur pour mettre en exergue le jeu sélectionné _______*/
    /*/////////////////////////////////////////////////////////////////////////*/
    .slider-jeux:before{
        background: linear-gradient(to right, rgba(0, 30, 255, 0.25) 50%, transparent);
        content: '';
        height: 300px;
        left: 0;
        position: fixed;
        top: 350px;
        width: 740px;
    }
    .slider-jeux:after{
        background: linear-gradient(to right, rgba(0, 148, 214, 0.28) 50%, transparent);
        content: '';
        height: 300px;
        left: 0;
        position: fixed;
        top: 350px;
        width: 500px;
    }

    /*____________ Conteneurs ___________*/
    /*///////////////////////////////////*/
    /* Conteneur de l'ensemble des marquees */
    .slider-jeux__cont{
        transform: translateX(100px) translateZ(0);
        position: absolute;
        z-index: 9;
    }

    /* Conteneur pour chaque jeu */
    .slider-jeux__jeu{
        transform: translateX(-1000px) translateZ(0);
        opacity: 1;
        padding: 5px 0;
        position: relative;
        transition: opacity 0.3s ease, padding 0.1s ease;
    }

    /*_______ Marquee _______*/
    /*///////////////////////*/
    .slider-jeux__marquee{
        background-size: cover;
        background-repeat: no-repeat;
        background-position: center;
        border-radius: 8px;
        box-shadow: 0 0 30px #000000;
        display: inline-block;
        height: 50px;
        overflow: hidden;
        position: relative;
        transition: height 0.3s ease, width 0.3s ease;
        vertical-align: middle;
        width: 300px;
    }

    /* Image du marquee */
    .slider-jeux__img-marquee{
        display: block;
        height: auto;
        left: 50%;
        position: relative;
        transform: translateX(-50%) translateY(-50%);
        top: 50%;
        width: 100%;
        z-index: -1;
    }

    /* Voile noir opacifiant légérement l'image du marquee */
    .slider-jeux__voile-marquee {
        background-color: #000000;
        height: 300px;
        opacity: 1;
        position: absolute;
        transition: opacity 0.3s ease;
        top: 0;
        width: 600px;
    }
</style>
