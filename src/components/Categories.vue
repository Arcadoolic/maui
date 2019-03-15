<template>
    <div class="categories">
        <div class="category" v-for="(category, index) in gameList.getCategories()" :class="getCategoryClasses(index)">
            <img src="../assets/categories/_default.svg" alt="">
        </div>
        <!--<figure ref="categoriesFigure">-->
            <!--<div class="category" :class="{selected: categorySelectedId === index, first: !index, last: index === gameList.getCategories().length, next: index === categorySelectedId + 1, previous: index === categorySelectedId - 1}"-->
                 <!--v-for="(category, index) in gameList.getCategories()"-->
            <!--&gt;-->
                <!--<p>{{category.name}}</p>-->
            <!--</div>-->
        <!--</figure>-->
    </div>
</template>

<script lang="ts">
import {Vue, Component, Prop, Model} from 'vue-property-decorator';
import GameList from '@/class/GameList.class';
import ControllableVue from '@/ControllableVue.vue';

@Component
export default class Categories extends ControllableVue {
    protected categorySelectedId: number = 2;

    protected gameList = new GameList();
    protected categoriesFigure!: HTMLElement;

    public created() {
        /** Init vars */
        this.gameList = this.$store.getters.gameList;

        /**
         * Register key events
         */
        this.onKeydown((e: Event, isGamepad: boolean) => {
            const key = (isGamepad) ? (e as CustomEvent).detail.key : (e as KeyboardEvent).key;
            switch (key) {
                case 'ArrowLeft':
                    this.moveLeft();
                    break;
                case 'ArrowRight':
                    this.moveRight();
                    break;
            }
        });

        this.onKeyup((e: Event, isGamepad: boolean) => {
            const key = (isGamepad) ? (e as CustomEvent).detail.key : (e as KeyboardEvent).key;
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
    protected moveLeft() {
        this.categorySelectedId = this.categorySelectedId <= 0 ?
            this.gameList.getCategories().length - 1 : this.categorySelectedId - 1;
        this.emitCategoryChange();
        this.updateCategoriesPosition();
    }

    /**
     * Called on move right
     */
    protected moveRight() {
        this.categorySelectedId = this.categorySelectedId >= this.gameList.getCategories().length - 1 ?
            0 : this.categorySelectedId + 1;
        this.emitCategoryChange();
        this.updateCategoriesPosition();
    }

    /**
     * Calculate category list position
     */
    protected updateCategoriesPosition() {
        (this.$refs.categoriesFigure as HTMLElement).style.left = '-' + (this.categorySelectedId * 150) + 'px';
    }

    /**
     * Emit event to parent when the selected category change
     */
    protected emitCategoryChange() {
        this.$emit('categoryChange', this.categorySelectedId);
    }

    protected get getCategoryClasses() {
        return (index: number) => {
            const catLen = this.gameList.getCategories().length;
            let previous = this.categorySelectedId - 1 === index;
            let previous2 = this.categorySelectedId - 2 === index;
            let next2 = this.categorySelectedId + 2 === index;
            if (this.categorySelectedId === 0)  {
                previous = index === catLen - 1;
                previous2 = index === catLen - 2;
            } else if (this.categorySelectedId === 1) {
                previous2 = catLen - 1 === index;
            }

            let next = this.categorySelectedId + 1 === index;
            if (this.categorySelectedId === catLen - 1) {
                next = 0 === index;
                next2 = 1 === index;
            } else if (this.categorySelectedId === catLen - 2) {
                next2 = 0 === index;
            }
            return {
                selected: this.categorySelectedId === index,
                previous: previous,
                next: next,
                previous2: previous2,
                next2: next2,
            }
        }
    }

}
</script>

<style scoped>
    .categories {
        width: 25%;
        height: 0;
        padding-bottom: 25%;
        position: absolute;
        display: block;
        right: -12%;
        /*right: 0;*/
        bottom: -25%;
        /*bottom: 0;*/
        /*bottom: ;*/
    }
        .categories .category {
            position: absolute;
            display: none;
            width: 30%;
            height: 30%;
            transition: all .3s ease;
        }
            .categories .category img {
                max-width: 100%;
            }
            .categories .category.next2 {
                display: block;
                transform: translate3d(200%, -50%, 0);
            }
            .categories .category.next {
                display: block;
                transform: translate3d(100%, -50%, 0);
            }
            .categories .category.selected {
                display: block;
                transform: translate3d(0, 0, 0);
            }
            .categories .category.previous {
                display: block;
                transform: translate3d(-50%, 100%, 0);
            }
            .categories .category.previous2 {
                display: block;
                transform: translate3d(-50%, 200%, 0);
            }





            /* Selected one */
            /*.categories .category[data-pos='0'] {*/
                /*display: block;*/
                /*transform: translateX(100%) translateY(100%);*/
                /*animation: xAxis 2.5s infinite, yAxis 2.5s infinite;*/
                /*top: 30%;*/
                /*left: 30%;*/
            /*}*/

            /*.categories .category[data-pos='-1'] {*/
                /*top: 10%;*/
                /*right: 0;*/
                /*display: block;*/
            /*}*/

            /*.categories .category[data-pos='-2'] {*/
                /*top: 10%;*/
                /*right: -30%;*/
                /*display: block;*/
            /*}*/

            /*.categories .category[data-pos='1'] {*/
                /*bottom: 0;*/
                /*left: 10%;*/
                /*display: block;*/
            /*}*/
            /*.categories .category[data-pos='2'] {*/
                /*bottom: -30%;*/
                /*left: 10%;*/
                /*display: block;*/
            /*}*/



    /*.categories figure {*/
        /*position: relative;*/
        /*height: 200px;*/
        /*margin: 0;*/
        /*padding: 0;*/
        /*transition: left 0.3s ease-in-out;*/
    /*}*/
    /*.categories figure .category {*/
        /*text-align: center;*/
        /*margin-top: 50px;*/
        /*width: 150px;*/
        /*float: left;*/
        /*height: 150px;*/
        /*transition: width 0.2s ease-in-out, height 0.2s ease-in-out, margin-top 0.2s ease-in-out, font-size 0.2s ease-in-out;*/
        /*bottom: 0;*/
    /*}*/
    /*.categories figure .category.first {*/
        /*margin-left: 150px;*/
    /*}*/
    /*.categories figure .category.selected {*/
        /*position: relative;*/
        /*margin-top: 0;*/
        /*width: 250px;*/
        /*height: 200px;*/
        /*z-index: 2;*/
        /*font-size: 2em;*/
    /*}*/
    /*.categories figure .category.previous {*/
        /*position: relative;*/
        /*margin-right: -40px;*/
        /*z-index: 1;*/
    /*}*/
    /*.categories figure .category.next {*/
        /*position: relative;*/
        /*margin-left: -40px;*/
        /*z-index: 1;*/
    /*}*/
</style>
