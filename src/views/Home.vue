<template>
    <div class="main-container">
        <ul :class="{hovered: verticalSelect === 1}" class="games">
            <li v-for="(game, index) in gameFromCurrentCategory"
                :class="{selected: gameSelected === index}">{{game.fullname}}
            </li>
        </ul>

        <Categories :class="{hovered: verticalSelect === 2}"></Categories>
    </div>
</template>

<script lang="ts">
import {Vue, Component, Prop} from 'vue-property-decorator';
import GameList from '../class/GameList.class';
import Categories from '@/components/Categories.vue';

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

    public created() {
        this.gameList = this.$store.getters.gameList;

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
