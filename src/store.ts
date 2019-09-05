import Vue from 'vue';
import Vuex from 'vuex';
import Config from '@/class/Config.class';
import {remote} from 'electron';
import Database from '@/class/Database.class';
import GameService from '@/class/GameService.class';
import MameService from '@/class/MameService.class';
import UserService from '@/class/UserService.class';
import HiscoreService from '@/class/HiscoreService.class';


Vue.use(Vuex);

export default new Vuex.Store({
    state: {
        configuration: new Config(remote.app.getPath('appData')),
        database: new Database(remote.app.getPath('appData')),
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
