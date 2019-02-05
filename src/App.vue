<template>
    <div id="app">
        <router-view></router-view>
    </div>
</template>

<script lang="ts">
    import {Component, Vue} from 'vue-property-decorator';

    @Component
    export default class Home extends Vue {
        public created() {
            this.$store.commit('initGameList');

            // window.addEventListener('keydown', (e) => {
            //     if (e.code === 'ArrowLeft') {
            //         if (this.categorySelected - 1 >= 0) {
            //             this.categorySelected--;
            //         } else {
            //             this.categorySelected = this.gameList.getCategories().length - 1;
            //         }
            //     } else if (e.code === 'ArrowRight') {
            //         this.categorySelected = (this.categorySelected + 1
            //         >= this.gameList.getCategories().length) ? 0 : this.categorySelected + 1;
            //     }
            // });

        }
    }
</script>

<style>
    body {
        background-image: url(./assets/background.jpg);
        color: white
    }
</style>
