<template>
    <div id="app">
        <div class="categories">
            <div class="container">
                <ul>
                    <li v-for="(category, index) in gameList.getCategories()"
                        :class="{selected: categorySelected === index}"
                    >{{category.name}}</li>
                </ul>
            </div>
        </div>
        <hr>
        <ul>
            <li v-for="game in gameFromCurrentCategory">{{game.fullname}}</li>
        </ul>

        <button @click.prevent="refreshGame()">Refresh game</button>
    </div>
</template>

<script lang="ts">
    import {Component, Prop, Vue} from 'vue-property-decorator';
    import fs from 'fs';
    import GameList from './class/GameList.class';
    import GameCategory from '@/class/GameCategory.class';

    @Component
    export default class Home extends Vue {
        protected gameList = new GameList();
        protected categorySelected = 0;

        @Prop() private msg!: string;

        public created() {
            this.refreshGame();

            window.addEventListener('keydown', (e) => {
                if (e.code === 'ArrowLeft') {
                    if (this.categorySelected - 1 >= 0) {
                        this.categorySelected--;
                    } else {
                        this.categorySelected = this.gameList.getCategories().length - 1;
                    }
                } else if (e.code === 'ArrowRight') {
                    this.categorySelected = (this.categorySelected + 1 >= this.gameList.getCategories().length) ? 0 : this.categorySelected + 1;
                }
            });

        }

        /**
         * Refresh categories and game list
         */
        public refreshGame() {
            this.gameList.initCategories('./config/categories.json');
            this.gameList.initGames('./games');
            this.categorySelected = 0;
        }

        public get gameFromCurrentCategory()
        {
            return this.gameList.getCategories()[this.categorySelected].getGames();
        }
    }
</script>

<style>
    body { background-image: url(./assets/background.jpg); color: white }

    .categories {
        display: block;
    }
    .categories:after {
        content: '';
        display: block;
        clear: both;
    }
    .categories .container {
        position: relative;
        text-align: center;
        overflow: hidden;
        height: 30px;
        margin: 0 auto;
    }
    .categories ul {
        width: 10000px;
        position: absolute;
        list-style: none;
        margin: 0;
        padding: 0;
    }
        .categories ul li {
            display: inline-block;
            height: 30px;
            float: left;
            margin: 0 10px;
            padding: 0;
        }

            .categories ul li.selected {
                font-weight: bold;
                color: red;
            }
</style>
