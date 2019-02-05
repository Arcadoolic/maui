<template>
    <div>
        <div class="categories">
            <div class="container">
                <ul>
                    <li v-for="(category, index) in gameList.getCategories()"
                        :class="{selected: categorySelected === index}"
                    >{{category.name}}
                    </li>
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
    import {Vue, Component} from 'vue-property-decorator';
    import GameList from '../class/GameList.class';

    @Component
    export default class Home extends Vue {
        protected gameList = new GameList();
        protected categorySelected = 0;

        public created() {
            console.log('created');
            this.gameList = this.$store.getters.gameList;
            console.log(this.gameList);
        }

        /**
         * Refresh categories and game list
         */
        public refreshGame() {
            this.$store.commit('reloadGameList');
        }

        /**
         *
         */
        public get gameFromCurrentCategory() {
            return this.gameList.getCategories()[this.categorySelected].getGames();
        }
    }
</script>

<style scoped>
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
