import Vue from 'vue';
import Vuex from 'vuex';
import GameList from '@/class/GameList.class';
import Config from '@/class/Config.class';
import Mame from '@/class/Mame.class';
import HiscoreService from '@/class/HiscoreService.class';
import Players from '@/class/Players.class';

Vue.use(Vuex);

export default new Vuex.Store({
    state: {
        config: new Config(),
        gameList: new GameList(),
        mame: new Mame(),
        hiscore: null as HiscoreService|null,
        isInit: false,
        players: null as Players|null
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
        hiscore: (state): HiscoreService => {
            return state.hiscore!;
        },
        isInit: (state): boolean => {
            return state.isInit;
        },
        players: (state): Players => {
            return state.players!;
        },
    },
    mutations: {
        isInit: (state) => {
            state.isInit = true;
        },
        setHiscore: (state, hiscore: HiscoreService) => {
            state.hiscore = hiscore;
        },
        setPlayers: (state, players: Players) => {
            state.players = players;
        },
    },
});
