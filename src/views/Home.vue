<template>
    <div>
        {{verticalSelect}}
        <div class="categories" :class="{hovered: verticalSelect === 1}">
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
        <ul :class="{hovered: verticalSelect === 2}">
            <li v-for="game in gameFromCurrentCategory">{{game.fullname}}</li>
        </ul>

        <button @click.prevent="refreshGame()">Refresh game</button>
    </div>
</template>

<script lang="ts">
    import {Vue, Component, Prop} from 'vue-property-decorator';
    import GameList from '../class/GameList.class';

    @Component
    export default class Home extends Vue {
        protected gameList = new GameList();
        protected categorySelected = 0;

        @Prop({ required: true, default: 0 })
        protected verticalSelect?: number;

        public created() {
            console.log('created');
            this.gameList = this.$store.getters.gameList;
            console.log(this.gameList);

            window.addEventListener('keyup', (e) => {
                if (e.code === 'Enter') {
                    console.log('Enter');
                    if (this.verticalSelect === 2) {
                        console.log('Enter2');
                        this.$emit('blockVerticalSelect', true);
                    }
                } else if (e.code === 'Escape') {
                    if (this.verticalSelect === 2) {
                        this.$emit('blockVerticalSelect', false);
                    }
                }
            });
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

        public moveVertical() {
            console.log('moveVertical');
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

    .hovered { background: blue }
</style>
