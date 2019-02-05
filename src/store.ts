import Vue from 'vue';
import Vuex from 'vuex';
import GameList from '@/class/GameList.class';

Vue.use(Vuex);

export default new Vuex.Store({
    state: {
        gameList: (null as GameList|null),
    },
    getters: {
        gameList: (state) => {
            return state.gameList;
        },
    },
    mutations: {
        initGameList(state) {
            if (!state.gameList) {
                state.gameList = new GameList();
                state.gameList.initCategories('./config/categories.json');
                state.gameList.initGames('./games');
            }
        },
        reloadGameList(state) {
            if (state.gameList) {
                state.gameList.initCategories('./config/categories.json');
                state.gameList.initGames('./games');
            }
        },
    },
    actions: {},
});
