<template>
    <div class="categories">
        <figure ref="categoriesFigure">
            <div class="category" :class="{selected: categorySelected === index, first: !index, last: index === gameList.getCategories().length, next: index === categorySelected + 1, previous: index === categorySelected - 1}"
                 v-for="(category, index) in gameList.getCategories()"
            >
                <p>{{category.name}}</p>
            </div>
        </figure>
    </div>
</template>

<script lang="ts">
    import {Vue, Component} from 'vue-property-decorator';
    import GameList from '@/class/GameList.class';

    @Component
    export default class Categories extends Vue {
        protected gameList = new GameList();
        protected categorySelected = 0;

        protected categoriesFigure!: HTMLElement;

        public created() {
            this.gameList = this.$store.getters.gameList;

            window.addEventListener('keydown', (e) => {
                if (e.code === 'ArrowLeft') {
                    this.categorySelected--;
                    if (this.categorySelected < 0) {
                        this.categorySelected = this.gameList.getCategories().length - 1;
                    }
                    (this.$refs.categoriesFigure as HTMLElement).style.left = '-' + (this.categorySelected * 150) + 'px';
                } else if (e.code === 'ArrowRight') {
                    this.categorySelected++;
                    if (this.categorySelected >= this.gameList.getCategories().length) {
                        this.categorySelected = 0;
                    }
                    (this.$refs.categoriesFigure as HTMLElement).style.left = '-' + (this.categorySelected * 150) + 'px';
                }
            });
        }

        public mounted() {
            // Category list figure size
            this.categoriesFigure = this.$refs.categoriesFigure as HTMLElement;
            this.categoriesFigure.style.width = ((this.gameList.getCategories().length + 1) * 150 + 300) + 'px';
        }

    }
</script>

<style scoped>
    .categories {
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
        transition: left 0.2s;
    }
    .categories figure .category {
        text-align: center;
        margin-top: 50px;
        width: 150px;
        float: left;
        height: 150px;
        transition: width 0.2s, height 0.2s;
        background: yellowgreen;
        bottom: 0;
    }
    .categories figure .category.first {
        margin-left: 150px;
    }
    .categories figure .category.selected {
        margin-top: 0;
        width: 250px;
        height: 200px;
        z-index: 2;
        opacity: 0.2;
    }
    .categories figure .category.previous {
        margin-right: -40px;
        background: red;
        z-index: 1;
        transform: rotateY(40deg);
    }
    .categories figure .category.next {
        margin-left: -40px;
        z-index: 1;
        background: red;
        transform: rotateY(-40deg);
    }
    /*.categories figure .category.previous.first {*/
        /*margin-left: 150px;*/
    /*}*/
</style>
