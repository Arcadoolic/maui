<template>
    <div class="categories">
        <figure ref="categoriesFigure">
            <div class="category" :class="{selected: categorySelectedId === index, first: !index, last: index === gameList.getCategories().length, next: index === categorySelectedId + 1, previous: index === categorySelectedId - 1}"
                 v-for="(category, index) in gameList.getCategories()"
            >
                <p>{{category.name}}</p>
            </div>
        </figure>
    </div>
</template>

<script lang="ts">
import {Vue, Component, Prop, Model} from 'vue-property-decorator';
import GameList from '@/class/GameList.class';

@Component
export default class Categories extends Vue {
    protected categorySelectedId: number = 0;

    protected gameList = new GameList();
    protected categoriesFigure!: HTMLElement;

    public created() {
        /** Init vars */
        this.gameList = this.$store.getters.gameList;

        /**
         * Register key events
         */
        window.addEventListener('keydown', (e) => {
            switch (e.key) {
                case 'ArrowLeft':
                    this.moveLeft();
                    break;
                case 'ArrowRight':
                    this.moveRight();
                    break;
            }
        });
    }

    public mounted() {
        // Category list figure size
        this.categoriesFigure = this.$refs.categoriesFigure as HTMLElement;
        this.categoriesFigure.style.width = ((this.gameList.getCategories().length + 1) * 150 + 300) + 'px';
    }

    /**
     * Called on move left
     */
    public moveLeft() {
        this.categorySelectedId = this.categorySelectedId <= 0 ?
            this.gameList.getCategories().length - 1 : this.categorySelectedId - 1;
        this.emitCategoryChange();
        this.updateCategoriesPosition();
    }

    /**
     * Called on move right
     */
    public moveRight() {
        this.categorySelectedId = this.categorySelectedId >= this.gameList.getCategories().length - 1 ?
            0 : this.categorySelectedId + 1;
        this.emitCategoryChange();
        this.updateCategoriesPosition();
    }

    /**
     * Calculate category list position
     */
    public updateCategoriesPosition() {
        (this.$refs.categoriesFigure as HTMLElement).style.left = '-' + (this.categorySelectedId * 150) + 'px';
    }

    /**
     * Emit event to parent when the selected category change
     */
    public emitCategoryChange() {
        this.$emit('categoryChange', this.categorySelectedId);
    }

}
</script>

<style scoped>
    .categories {
        color: green;
        position: absolute;
        bottom: 0;
        right: 40px;
        display: block;
        height: 200px;
        width: 470px;
        overflow: hidden;
    }

    .categories figure {
        position: relative;
        height: 200px;
        margin: 0;
        padding: 0;
        transition: left 0.3s ease-in-out;
    }
    .categories figure .category {
        text-align: center;
        margin-top: 50px;
        width: 150px;
        float: left;
        height: 150px;
        transition: width 0.2s ease-in-out, height 0.2s ease-in-out, margin-top 0.2s ease-in-out, font-size 0.2s ease-in-out;
        bottom: 0;
    }
    .categories figure .category.first {
        margin-left: 150px;
    }
    .categories figure .category.selected {
        position: relative;
        margin-top: 0;
        width: 250px;
        height: 200px;
        z-index: 2;
        font-size: 2em;
    }
    .categories figure .category.previous {
        position: relative;
        margin-right: -40px;
        z-index: 1;
    }
    .categories figure .category.next {
        position: relative;
        margin-left: -40px;
        z-index: 1;
    }
</style>
