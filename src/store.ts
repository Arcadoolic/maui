import Vue from 'vue';
import Vuex from 'vuex';
// import GameList from '@/class/GameList.class';
import Config from '@/class/Config.class';
// import Mame from '@/class/Mame.class';
// import HiscoreService from '@/class/HiscoreService.class';
// import Players from '@/class/Players.class';
// import IPDDatabase from '@/class/IPDDatabase.class';
// import FileLogger from '@/class/FileLogger.class';
// import GameService from '@/class/GameService.class';
import Database from '@/class/Database.class';
import GameService from '@/class/GameService.class';
import MameService from '@/class/MameService.class';
import UserService from '@/class/UserService.class';
import User from '@/model/User.model';
import HiscoreService from '@/class/HiscoreService.class';


Vue.use(Vuex);

export default new Vuex.Store({
    state: {
        test: '',
        configuration: new Config(),
        database: new Database(),
        mameService: null as MameService|null,
        gameService: null as GameService|null,
        userService: null as UserService|null,
        hiscoreService: null as HiscoreService|null,
        // gameList: new GameList(),
        // mame: new Mame(),
        // hiscore: null as HiscoreService|null,
        isInit: false,
        // players: null as Players|null,
        // db: null as IPDDatabase|null,
        // logger: null as FileLogger|null,
        // gameService: null as GameService|null,
    },
    getters: {
        isInit: (state): boolean =>  state.isInit,
        configuration: (state): Config => state.configuration,
        database: (state): Database => state.database!,
        mameService: (state): MameService => state.mameService!,
        gameService: (state): GameService => state.gameService!,
        userService: (state): UserService => state.userService!,
        hiscoreService: (state): HiscoreService => state.hiscoreService!,

        // gameList: (state) => {
        //     return state.gameList;
        // },
        // mame: (state): Mame => {
        //     return state.mame;
        // },
        // hiscore: (state): HiscoreService => {
        //     return state.hiscore!;
        // },
        // isInit: (state): boolean => {
        //     return state.isInit;
        // },
        // players: (state): Players => {
        //     return state.players!;
        // },
        // db: (state): IPDDatabase => {
        //     return state.db!;
        // },
        // logger: (state): FileLogger => {
        //     return state.logger!;
        // },
        // gameService: (state): GameService => {
        //     return state.gameService!;
        // },

    },
    mutations: {
        initServices: (state) => {
            if (!state.isInit) {
                state.mameService = new MameService(state.configuration);
                state.gameService = new GameService(state.configuration, state.mameService);
                state.userService = new UserService();
                state.hiscoreService = new HiscoreService(state.mameService.iniPath, state.userService);
                state.isInit = true;
            }
        },
        // initHiscores: (state) => {
        //     state.hiscore = new HiscoreService(state.configuration, state.mame.mameUiPath);
        // },
        // initPlayers: (state) => {
        //     console.log(state.configuration.faceyourmangaPath);
        //     state.players = new Players(state.configuration.faceyourmangaPath);
        // },
        // initDatabase: (state) => {
        //     state.db = new IPDDatabase(state.configuration, state.players!);
        // },
        // initLogger: (state, path: string) => {
        //     state.logger = new FileLogger(path);
        // },
        // initGameService: (state) => {
        //     state.gameService = new GameService(
        //         state.configuration,
        //         state.mame,
        //         state.gameList,
        //         state.hiscore!,
        //         state.db!,
        //         state.logger!);
        // },
    },
});
