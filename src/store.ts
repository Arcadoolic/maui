import Vue from 'vue';
import Vuex from 'vuex';
import GameList from '@/class/GameList.class';
import Config from '@/class/Config.class';
import Mame from '@/class/Mame.class';
import HiscoreService from '@/class/HiscoreService.class';
import Players from '@/class/Players.class';
import IPDDatabase from '@/class/IPDDatabase.class';
import FileLogger from '@/class/FileLogger.class';
import GameService from '@/class/GameService.class';
import Database from '@/class/Database.class';

Vue.use(Vuex);

export default new Vuex.Store({
    state: {
        test: '',
        configuration: new Config(),
        gameList: new GameList(),
        mame: new Mame(),
        hiscore: null as HiscoreService|null,
        isInit: false,
        players: null as Players|null,
        db: null as IPDDatabase|null,
        logger: null as FileLogger|null,
        gameService: null as GameService|null,
        database: new Database(),
    },
    getters: {
        gameList: (state) => {
            return state.gameList;
        },
        configuration: (state): Config => {
            return state.configuration;
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
        db: (state): IPDDatabase => {
            return state.db!;
        },
        logger: (state): FileLogger => {
            return state.logger!;
        },
        gameService: (state): GameService => {
            return state.gameService!;
        },
        database: (state): Database => {
            return state.database!;
        },
        test: (state) => {
            return state.test;
        },
    },
    mutations: {
        isInit: (state) => {
            state.isInit = true;
        },
        initHiscores: (state) => {
            state.hiscore = new HiscoreService(state.configuration, state.mame.mameUiPath);
        },
        initPlayers: (state) => {
            console.log(state.configuration.faceyourmangaPath);
            state.players = new Players(state.configuration.faceyourmangaPath);
        },
        initDatabase: (state) => {
            state.db = new IPDDatabase(state.configuration, state.players!);
        },
        initLogger: (state, path: string) => {
            state.logger = new FileLogger(path);
        },
        initGameService: (state) => {
            state.gameService = new GameService(
                state.configuration,
                state.mame,
                state.gameList,
                state.hiscore!,
                state.db!,
                state.logger!);
        },
    },
});
