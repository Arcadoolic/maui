import Vue from 'vue';
import Vuex from 'vuex';
import GameList from '@/class/GameList.class';
import Config from '@/class/Config.class';
import Mame from '@/class/Mame.class';

Vue.use(Vuex);

export default new Vuex.Store({
    state: {
        config: new Config(),
        gameList: (null as GameList|null),
        mame: new Mame(),
    },
    getters: {
        gameList: (state) => {
            return state.gameList;
        },
        config: (state): Config => {
            return state.config;
        },
        mame: (state): Mame => {
            return state.mame;
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
