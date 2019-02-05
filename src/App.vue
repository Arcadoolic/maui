<template>
    <div id="app">
        <nav :class="{hovered: verticalSelect == 0}">
            <router-link to="/">
                <p>Home</p>
            </router-link>
            <router-link to="/">
                <p>Search</p>
            </router-link>
            <router-link to="/">
                <p>Options</p>
            </router-link>
        </nav>
        <router-view :verticalSelect="verticalSelect" @blockVerticalSelect="setBlockVerticalSelect"></router-view>
    </div>
</template>

<script lang="ts">
    import {Component, Vue} from 'vue-property-decorator';

    @Component
    export default class App extends Vue {
        protected verticalSelect: number = 0;
        protected blockVerticalSelect: boolean = false;
        protected maxVerticalSelect: number = 2;

        public created() {
            this.$store.commit('initGameList');

            window.addEventListener('keyup', (e) => {

                if (e.code === 'ArrowUp') {
                    if (!this.blockVerticalSelect) {
                        this.verticalSelect--;
                        if (this.verticalSelect < 0) {
                            this.verticalSelect = this.maxVerticalSelect;
                        }
                    }
                } else if (e.code === 'ArrowDown') {
                    if (!this.blockVerticalSelect) {
                        this.verticalSelect++;
                        if (this.verticalSelect > this.maxVerticalSelect) {
                            this.verticalSelect = 0;
                        }
                    }
                }
            });
        }

        /**
         *
         * @param val
         */
        protected setBlockVerticalSelect(val: boolean) {
            this.blockVerticalSelect = val;
        }
    }
</script>

<style>
    body {
        background-image: url(./assets/background.jpg);
        color: white;
        margin: 0;
        padding: 0;
    }

    nav {
        width: 100%;
        height: 20px;
        background: red;
    }
    nav.hovered {
        height: 60px;
    }
        nav p {
            padding: 0;
            margin: 0;
            display: none;
        }

        nav.hovered p {
            display: inline-block;
        }
</style>
