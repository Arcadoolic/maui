import Config from '@/class/Config.class';
import Database from '@/class/Database.class';
import GameService from '@/class/GameService.class';
import MameService from '@/class/MameService.class';
import UserService from '@/class/UserService.class';
import HiscoreService from '@/class/HiscoreService.class';

// Replaces the Vuex store (src/store.ts, deleted at step 5 - see DECISIONS.md D3). Every
// `$store` access in the app was an imperative read inside a method: zero template bindings,
// zero computed, zero watch, so Vuex's reactivity bought nothing here. This is the same
// dependency-injection responsibility (build the services once, in order, hand them out), with
// no framework underneath.

const configuration = new Config();
const database = new Database();

let mameService: MameService | null = null;
let gameService: GameService | null = null;
let userService: UserService | null = null;
let hiscoreService: HiscoreService | null = null;
let isInit = false;

/**
 * Builds mameService/userService/hiscoreService/gameService in the same dependency order as the
 * old Vuex `initServices` mutation, exactly once. Called from Init.vue's onMounted once the
 * config file is confirmed to exist and be loaded.
 */
export function initServices(): void {
    if (isInit) {
        return;
    }
    mameService = new MameService(configuration);
    userService = new UserService(configuration);
    hiscoreService = new HiscoreService(mameService.iniPath, userService);
    gameService = new GameService(mameService, hiscoreService);
    isInit = true;
}

export function getIsInit(): boolean {
    return isInit;
}

export function getConfiguration(): Config {
    return configuration;
}

export function getDatabase(): Database {
    return database;
}

export function getMameService(): MameService {
    return mameService!;
}

export function getGameService(): GameService {
    return gameService!;
}

export function getUserService(): UserService {
    return userService!;
}

export function getHiscoreService(): HiscoreService {
    return hiscoreService!;
}
