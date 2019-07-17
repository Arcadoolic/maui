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
        configuration: new Config(),
        database: new Database(),
        mameService: null as MameService|null,
        gameService: null as GameService|null,
        userService: null as UserService|null,
        hiscoreService: null as HiscoreService|null,
        isInit: false,
    },
    getters: {
        isInit: (state): boolean =>  state.isInit,
        configuration: (state): Config => state.configuration,
        database: (state): Database => state.database!,
        mameService: (state): MameService => state.mameService!,
        gameService: (state): GameService => state.gameService!,
        userService: (state): UserService => state.userService!,
        hiscoreService: (state): HiscoreService => state.hiscoreService!,
    },
    mutations: {
        initServices: (state) => {
            if (!state.isInit) {
                state.mameService = new MameService(state.configuration);
                state.userService = new UserService(state.configuration);
                state.hiscoreService = new HiscoreService(state.mameService.iniPath, state.userService);
                state.gameService = new GameService(state.mameService, state.hiscoreService);
                state.isInit = true;
            }
        },
    },
});
