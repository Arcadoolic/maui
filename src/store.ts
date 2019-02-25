import Vue from 'vue';
import Vuex from 'vuex';
import GameList from '@/class/GameList.class';
import Config from '@/class/Config.class';

Vue.use(Vuex);

export default new Vuex.Store({
    state: {
        config: (null as Config|null),
        gameList: (null as GameList|null),
    },
    getters: {
        gameList: (state) => {
            return state.gameList;
        },
        config: (state) => {
            return state.config;
        }
    },
    mutations: {
        initConfig(state) {
            state.config = new Config();
        },
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
