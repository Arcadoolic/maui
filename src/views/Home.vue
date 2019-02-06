<template>
    <div class="main-container">
        <ul :class="{hovered: verticalSelect === 1}" class="games">
            <li v-for="(game, index) in gameFromCurrentCategory"
                :class="{selected: gameSelected === index}">{{game.fullname}}
            </li>
        </ul>

        <div class="categories" :class="{hovered: verticalSelect === 2}">
            <figure>
                <div class="category" :class="{selected: categorySelected === index}"
                     v-for="(category, index) in gameList.getCategories()"
                >
                    <p>{{category.name}}</p>
                </div>
            </figure>
        </div>
    </div>
</template>

<script lang="ts">
import {Vue, Component, Prop} from 'vue-property-decorator';
import GameList from '../class/GameList.class';

@Component
export default class Home extends Vue {
    protected blockVerticalSelect = false;

    protected gameList = new GameList();
    protected categorySelected = 0;

    protected gameSelected = 0;

    @Prop({required: true, default: 0})
    protected verticalSelect?: number;

    public created() {
        console.log('created');
        this.gameList = this.$store.getters.gameList;
        console.log(this.gameList);

        window.addEventListener('keyup', (e) => {
            if (e.code === 'Enter') {
                if (this.verticalSelect === 1) {
                    if (this.blockVerticalSelect) {
                        if (this.gameFromCurrentCategory[this.gameSelected]) {
                            this.gameFromCurrentCategory[this.gameSelected].start();
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
    .main-container {
        display: block;
        position: relative;
        width: 100%;
        height: 100%;
    }

    .categories {
        position: absolute;
        bottom: 0;
        right: 40px;
        display: block;
        height: 200px;
        width: 500px;
        overflow: hidden;
    }
        .categories figure {
            position: relative;
            width: 500px;
            height: 200px;
            margin: 0;
            padding: 0;
        }
            .categories figure .category {
                width: 200px;
                float: left;
                height: 200px;
            }

    .games {
        padding: 0;
        margin: 0;
    }

    .games .selected {
        color: black
    }

    .hovered {
        background: blue
    }
</style>
