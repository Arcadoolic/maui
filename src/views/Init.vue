<template>
    <div :class="{leaving}">
        <p v-if="error" class="error">{{ error }}</p>
    </div>
</template>

<script setup lang="ts">
import * as remote from '@electron/remote';
import {ref, onMounted, nextTick} from 'vue';
import router from '@/router';
import {emitter} from '@/emitter';
import {
    getConfiguration,
    getDatabase,
    initServices,
    getMameService,
    getGameService,
    getUserService,
    getHiscoreService,
} from '@/services';

const error = ref<string | null>(null);
const leaving = ref(false);

// Home resizes this same window (fullscreen or 1280x720) as soon as its setup runs, before this
// view's DOM is replaced: the splash, anchored to the window's top-left corner, would visibly
// slide along with it. Blank it first, and wait for that black frame to be painted.
async function blankSplash() {
    leaving.value = true;
    await nextTick();
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
}

remote.getCurrentWindow().setResizable(true);
remote.getCurrentWindow().setFullScreen(false);
remote.getCurrentWindow().setSize(346, 354);
remote.getCurrentWindow().center();

onMounted(async () => {
    const config = getConfiguration();
    const database = getDatabase();

    try {
        if (!database.exist()) {
            // Create database file if not existing
            await database.install();
        } else {
            await database.update();
        }
    } catch (e) {
        // e.g. Database.install() refusing to run because genre.ini hasn't been installed yet by
        // a starting pack import - stay on this screen with the message instead of silently
        // hanging on a blank splash.
        error.value = e instanceof Error ? e.message : 'Unexpected startup error.';
        return;
    }

    config.load();
    if (!config.loaded()) {
        // If no config or not valid, redirect to config page. Run above the database bootstrap:
        // Config.vue sends the user to the BO to set the MAME path, and the BO's login needs the
        // bo_user table (created and seeded by that bootstrap) to work even before MAME is
        // configured.
        router.push({name: 'config'});
        return;
    }
    initServices();
    const mameService = getMameService();
    const gameService = getGameService();
    const userService = getUserService();
    const hiService = getHiscoreService();

    try {
        // (Re)seed categories from genre.ini before syncing games below: it may have been added
        // (or replaced) after the database already existed, and games are synced with an
        // id_category that must already exist in this table (see Database.syncCategories()'s own
        // comment).
        await database.syncCategories(gameService);

        // Save new games
        const romList = mameService.getRomListFromFavorites();
        await gameService.saveGamesFromRomNames(romList);

        await userService.loadUsers();
        hiService.saveHiscores(await gameService.loadGames()).then(() => {
            emitter.emit('hiscores-loaded');
        });

        await blankSplash();
        router.push({name: 'home'});
    } catch (e) {
        error.value = e instanceof Error ? e.message : 'Unexpected startup error.';
    }
});
</script>

<style scoped>
    div {
        display: block;
        width: 100%;
        height: 100%;
        background-color: #000000;
        background-image: url(../assets/splash_screen_arcade.png);
        background-size: cover;
        background-repeat: repeat;
        background-position: 0 0;
    }
    div.leaving {
        background-image: none;
    }
    .error {
        margin: 0;
        padding: 24px 16px;
        color: #ff6b6b;
        font-family: sans-serif;
        text-align: center;
    }
</style>
