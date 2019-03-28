import Vue from 'vue';
import Vuex from 'vuex';
import GameList from '@/class/GameList.class';
import Config from '@/class/Config.class';
import Mame from '@/class/Mame.class';
import HiScore from '@/class/HiScore.class';

Vue.use(Vuex);

export default new Vuex.Store({
    state: {
        config: new Config(),
        gameList: new GameList(),
        mame: new Mame(),
        hiscore: null as HiScore|null,
        isInit: false,
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
        hiscore: (state): HiScore => {
            return state.hiscore!;
        },
        isInit: (state): boolean => {
            return state.isInit;
        },
    },
    mutations: {
        isInit: (state) => {
            state.isInit = true;
        },
        setHiscore: (state, hiscore: HiScore) => {
            state.hiscore = hiscore;
        },
    },
});
