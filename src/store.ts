import Vue from 'vue';
import Vuex from 'vuex';
import GameList from '@/class/GameList.class';
import Config from '@/class/Config.class';
import Mame from '@/class/Mame.class';

Vue.use(Vuex);

export default new Vuex.Store({
    state: {
        config: new Config(),
        gameList: new GameList(),
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
});
