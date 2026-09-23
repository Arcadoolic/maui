<template>
    <div class="home" :class="{empty: noGames}">
        <modal v-if="showLoader">
            <p>{{loaderTitle}}</p>
            <loader :duration="loaderDuration"></loader>
        </modal>


        <user-registration v-if="showAddUser" @quit="showAddUser = false"></user-registration>

        <vote-modal v-if="voteGame" @vote="onVote" @skip="voteGame = null"></vote-modal>

        <transition name="title">
            <div class="gameTitle" v-if="selectedGame" v-show="showTitle">
                <h1>{{selectedGame.shortname}}</h1>
                <p>{{selectedGame.year}}<template v-if="selectedGame.studio"> ({{selectedGame.studioLabel}})</template><template v-if="hasPlayerInfo"> - {{selectedGame.players}}</template></p>
            </div>
        </transition>

        <transition name="category">
            <div class="categoryTitle" :class="{'behind-hiscores': hiscoresVisible}" v-if="hasCategories" v-show="showTitle">
                <h1>{{category.name}}</h1>
            </div>
        </transition>

        <div class="no-games" v-if="noGames">
            <h1>No games yet</h1>
            <p>Add favorites in MAME, or import a starting pack from <strong>{{boUrl}}</strong></p>
        </div>

        <transition name="games">
            <Games v-if="!noGames" :games="games" :selectedGameIndex="selectedGameIndex" v-show="showGames"></Games>
        </transition>

        <transition name="flyer">
            <div class="flyer-container" v-show="showFlyer">
                <div class="flyer" v-if="flyer" :style="{backgroundImage: flyer ? 'url(' + flyer + ')' : false}"></div>
            </div>
        </transition>

        <Categories v-if="hasCategories" :categories="categories" :selectedCategoryIndex="selectedCategoryIndex"></Categories>

        <transition name="slide">
            <Hiscores :game="selectedGame" v-if="hiscoresVisible"></Hiscores>
        </transition>
    </div>

</template>

<script setup lang="ts">
import {ref, computed, onMounted} from 'vue';
import router from '@/router';
import Categories from '@/components/Categories.vue';
import Games from '@/components/Games.vue';
import Gamepads from '@/class/Gamepads.class';
import GameService from '@/class/GameService.class';
import Hiscores from '@/components/Hiscores.vue';
import {useControllable} from '@/composables/useControllable';
import * as remote from '@electron/remote';
import Game from '@/model/Game.model';
import {
    CarouselCategory, HISCORES_ONLY_CATEGORY, isDynamicCategory, isMergedCategory,
} from '@/types/CarouselCategory';
import {mergeTtlCategories} from '@/class/CarouselCategories';
import {join} from 'path';
import {BO_SERVER_PORT} from '@/boServerPort';
import {pathToFileURL} from 'url';
import {emitter} from '@/emitter';
import {MAUI_KEYS, LONG_PRESS_MS} from '@/class/MauiControls';
import {getIsInit, getConfiguration, getMameService, getGameService, getHiscoreService} from '@/services';
import * as Log from 'electron-log';
import UserRegistration from '@/components/userRegistration.vue';
import Loader from '@/components/Loader.vue';
import Modal from '@/components/Modal.vue';
import VoteModal from '@/components/VoteModal.vue';
import {Vote, VOTE_NEUTRAL, shouldAskVote} from '@/class/GameVote';

let gameService: GameService;

const games = ref<Game[]>([]);
const selectedGameIndex = ref(0);

const categories = ref<CarouselCategory[]>([]);
const selectedCategoryIndex = ref(0);
// Category whose name the bottom title shows. selectedCategoryIndex moves at once (the carousel
// icons need it to start turning), which made the title change its text while it was still
// sliding out: this one only catches up once the title is hidden (see onCategoryChange()).
const displayedCategoryIndex = ref(0);
const hasPlayerInfo = ref(false);

const timeouts: {
    quit?: number,
    showGame?: number,
    showFlyer?: number,
    addPlayer?: number,
} = {};

const showHiscores = ref(false);
const flyersPath = ref('');
const flyers = ref<string[]>([]);
const flyer = ref('');

const showGames = ref(true);
const showTitle = ref(true);
const showFlyer = ref(true);
const showLoader = ref(false);
const showAddUser = ref(false);
// The game whose vote is being asked, right after it was quit (see askVote()).
const voteGame = ref<Game | null>(null);
// Set once the first game list is loaded: an empty list then means no game on the cabinet at all
// (no favorite yet), shown as a message instead of an empty screen.
const gamesLoaded = ref(false);
const boUrl = `http://localhost:${BO_SERVER_PORT}`;
// No game at all: the message replaces the carousel (and its blue selection band).
const noGames = computed(() => gamesLoaded.value && !games.value.length);

const loaderDuration = ref(2);
const loaderTitle = ref('Button pressing');

const selectedGame = computed(() => games.value[selectedGameIndex.value] || null);

const category = computed(() => {
    if (displayedCategoryIndex.value) {
        return categories.value[displayedCategoryIndex.value - 1];
    }
    return {name: 'All Games'};
});

const hasCategories = computed(() => categories.value.length > 0);

// The scores table only exists for a game that has a .hi file, and only while the player asked for it.
const hiscoresVisible = computed(() => !!(selectedGame.value && selectedGame.value.hi && showHiscores.value));

function generateFlyerPath(): string {
    if (selectedGame.value) {
        const i = flyers.value.indexOf(selectedGame.value.romName + '.png');
        const path = i < 0 ? null : join(flyersPath.value, flyers.value[i]);
        if (!path) {
            return '';
        }
        // pathToFileURL(), not format({pathname, protocol: 'file', ...}): format() leaves Windows
        // backslashes as-is instead of converting them to the forward slashes a file: URL needs,
        // which broke image loading on Windows (the flyer never displayed).
        return pathToFileURL(path).href;
    }
    return '';
}

function onGameChange(previous: boolean) {
    const showFlyerFn = () => {
        flyer.value = generateFlyerPath();
        showFlyer.value = true;
    };
    showFlyer.value = false;
    clearTimeout(timeouts.showFlyer);
    timeouts.showFlyer = window.setTimeout(showFlyerFn, 300);
    selectedGameIndex.value = previous ?
        ((selectedGameIndex.value <= 0) ? games.value.length - 1 : selectedGameIndex.value - 1) :
        ((selectedGameIndex.value >= games.value.length - 1) ? 0 : selectedGameIndex.value + 1);
}

async function loadCategoryGames(categoryIndex: number): Promise<Game[]> {
    if (!categoryIndex) {
        return await gameService.loadGames();
    }
    const selected = categories.value[categoryIndex - 1];
    if (isDynamicCategory(selected)) {
        return await gameService.loadHiscoreGames();
    }
    if (isMergedCategory(selected)) {
        return await gameService.loadGamesByCategoryIds(selected.categoryIds);
    }
    return await selected.$get('games', {order: ['romName']}) as Game[] || [];
}

function onCategoryChange(previous: boolean) {
    const showGameFn = async () => {
        // The title finished sliding out (showTitle is false since the switch started): swap its
        // text now, it slides back in with the new name once the games are loaded below.
        displayedCategoryIndex.value = selectedCategoryIndex.value;
        // order: ['romName'], matching GameService.loadGames()'s "All games" ordering - without
        // it, $get('games') falls back to SQLite's unspecified row order, so a game's position
        // within its category no longer matched where it sits in the full list (e.g. "005" first
        // alphabetically, but wherever insertion order placed it inside its category).
        games.value = await loadCategoryGames(selectedCategoryIndex.value);

        selectedGameIndex.value = 0;
        flyer.value = generateFlyerPath();

        showGames.value = true;
        showTitle.value = true;
        showFlyer.value = true;
    };
    showHiscores.value = false;
    showTitle.value = false;
    showFlyer.value = false;
    showGames.value = false;
    clearTimeout(timeouts.showGame);
    timeouts.showGame = window.setTimeout(showGameFn, 300);
    selectedCategoryIndex.value = previous ?
        ((selectedCategoryIndex.value <= 0) ? categories.value.length : selectedCategoryIndex.value - 1) :
        ((selectedCategoryIndex.value >= categories.value.length) ? 0 : selectedCategoryIndex.value + 1);
}

function startGame() {
    const mameService = getMameService();
    const hiService = getHiscoreService();
    const game = selectedGame.value;
    if (!game) {
        return;
    }
    mameService.startGame(game.romName).then(
        (gameProcess) => {
            getGameService().recordLaunch(game.romName).catch((err) => {
                Log.error('[Home] Error on game ' + game.id_game + ' launch recording.');
                Log.error(err);
            });
            gameProcess.on('close', () => {
                hiService.saveHiscores(game).then(() => {
                    emitter.emit('game-quit');
                    return askVote(game);
                }).catch((err) => {
                    Log.error('[Home] Error after game ' + game.id_game + ' quit.');
                    Log.error(err);
                });
            });
        },
        (err) => {
            Log.error('[Home] Error on game ' + game.id_game + ' launch.');
            Log.error(err);
        },
    );
}

/**
 * Once a game is quit: ask the vote, unless it was already given (a thumbs up / down is final)
 * or the BO turned the prompt off.
 */
async function askVote(game: Game) {
    // Both the setting and the vote itself can have been changed from the BO since this game was
    // loaded: read them again.
    const config = getConfiguration();
    config.load();
    await game.reload();
    if (shouldAskVote(game, config.voteEnabled)) {
        voteGame.value = game;
    }
}

async function onVote(vote: Vote) {
    const game = voteGame.value;
    voteGame.value = null;
    if (!game || vote === VOTE_NEUTRAL) {
        // Neutral is the vote of a game nobody voted on: nothing to save, it is asked again.
        return;
    }
    try {
        const removed = await gameService.applyVote(game, vote, getConfiguration().thumbsDownRemovesFavorite);
        if (removed) {
            await reloadAfterRemoval();
        }
    } catch (err) {
        Log.error('[Home] Error on game ' + game.id_game + ' vote.');
        Log.error(err);
    }
}

/**
 * A game left the favorites: refresh the carousel, which may have lost its category, and keep the
 * selection where it was.
 */
async function reloadAfterRemoval() {
    await loadCategories();
    let loadedGames = selectedCategoryIndex.value <= categories.value.length
        ? await loadCategoryGames(selectedCategoryIndex.value)
        : [];
    if (!loadedGames.length && selectedCategoryIndex.value) {
        // The category the game was in had no other game: back to "All Games".
        selectedCategoryIndex.value = 0;
        displayedCategoryIndex.value = 0;
        loadedGames = await loadCategoryGames(0);
    }
    games.value = loadedGames;
    selectedGameIndex.value = Math.min(selectedGameIndex.value, Math.max(loadedGames.length - 1, 0));
    flyer.value = generateFlyerPath();
}

async function loadCategories() {
    const storedCategories = mergeTtlCategories(await gameService.loadCategories());
    // Right after "All Games". Only offered once at least one game has extractable
    // hiscores: an empty category would be a dead end in the carousel.
    const hasHiscoreGames = (await gameService.loadHiscoreGames()).length > 0;
    categories.value = hasHiscoreGames ? [HISCORES_ONLY_CATEGORY, ...storedCategories] : storedCategories;
}

function addPlayer() {
    loaderDuration.value = LONG_PRESS_MS.newPlayer / 1000;
    showLoader.value = true;
    loaderTitle.value = 'Add new player ?';
    timeouts.addPlayer = window.setTimeout(() => {
        showLoader.value = false;
        showAddUser.value = true;
    }, LONG_PRESS_MS.newPlayer);
}

const {onKeydown, onKeyup} = useControllable();

function registerKeyMapping() {
    onKeydown((e, isGamepad) => {
        if (showAddUser.value || voteGame.value) {
            return;
        }
        const key = isGamepad ? (e as CustomEvent).detail.key : (e as KeyboardEvent).code;
        switch (key) {
        case MAUI_KEYS.up:
            onGameChange(true);
            break;
        case MAUI_KEYS.down:
            onGameChange(false);
            break;
        case MAUI_KEYS.left:
            if (hasCategories.value) {
                onCategoryChange(true);
            }
            break;
        case MAUI_KEYS.right:
            if (hasCategories.value) {
                onCategoryChange(false);
            }
            break;
        case MAUI_KEYS.space:
            showHiscores.value = !showHiscores.value;
            timeouts.quit = window.setTimeout(() => remote.app.quit(), LONG_PRESS_MS.quit);
            break;
        case MAUI_KEYS.enter:
            startGame();
            break;
        case MAUI_KEYS.p:
            addPlayer();
            break;
        }
    });

    onKeyup((e, isGamepad) => {
        if (showAddUser.value || voteGame.value) {
            return;
        }
        const key = isGamepad ? (e as CustomEvent).detail.key : (e as KeyboardEvent).code;
        switch (key) {
        case MAUI_KEYS.space:
            clearTimeout(timeouts.quit);
            break;
        case MAUI_KEYS.p:
            showLoader.value = false;
            clearTimeout(timeouts.addPlayer);
            break;
        }
    });
}

if (!getIsInit()) {
    router.push({name: 'init'});
} else {
    if (getConfiguration().fullscreen) {
        remote.getCurrentWindow().setFullScreen(true);
    } else {
        // Not dev-only: without this, a packaged build left in windowed mode keeps whatever size
        // Init.vue's splash screen set (346x354) instead of a usable default.
        remote.getCurrentWindow().setSize(1280, 720);
        remote.getCurrentWindow().center();
    }

    const mameService = getMameService();
    gameService = getGameService();

    onMounted(async () => {
        await loadCategories();
        games.value = await gameService.loadGames();
        gamesLoaded.value = true;
        // Start on the game played last, when there is one still in the favorites.
        const lastPlayed = await gameService.loadLastPlayedGame();
        const lastPlayedIndex = lastPlayed ? games.value.findIndex(g => g.romName === lastPlayed.romName) : -1;
        if (lastPlayedIndex >= 0) {
            selectedGameIndex.value = lastPlayedIndex;
        }
        hasPlayerInfo.value = !!mameService.nplayersIniPath;

        Gamepads.init();
        registerKeyMapping();

        flyersPath.value = mameService.flyerPath;
        flyers.value = gameService.loadFlyers();
        flyer.value = generateFlyerPath();
    });
}

onMounted(() => {
    if (getConfiguration().fullscreen) {
        remote.getCurrentWindow().setFullScreen(true);
    }
});
</script>

<style scoped>
    .home {
        display: block;
        width: 100%;
        height: 100%;
        background-color: #000000;
        background-image: url(../assets/background.jpg);
        background-size: cover;
        background-repeat: repeat;
        background-position: 0 0;
    }

    .gameTitle, .categoryTitle {
        position: absolute;
        width: 100%;
        z-index: 2;
        text-align: center;
        background: linear-gradient(to bottom, rgb(35, 10, 0) -30%, rgba(0, 0, 0, 0.3) 70%, transparent 100%);
        color: #fff513;
        font-size: 2.5vw; /*45px;*/
        padding: 26px;
        font-family: 'Arcade_I', sans-serif;
        perspective: 460px;
        perspective-origin: 50% 50%;
        text-shadow: 0 0 30px rgba(237, 106, 10, 0.8),
        0 3px 0 rgb(255, 81, 0),
        0 5px 20px rgba(255, 81, 0, 0.5),
        0 6px 5px rgba(242, 0, 10, 0.7),
        0 12px 16px rgba(0, 0, 0, 1),
        6px 12px 9px rgba(0, 0, 0, 1);
        filter: saturate(1.3);
    }
    /* No game: plain black, the wallpaper only comes with the games. */
    .home.empty {
        background-image: none;
    }

    /* Full screen, the message centered over the splash logo, faint like on the first-run screen
       (Config.vue). */
    .no-games {
        position: absolute;
        inset: 0;
        z-index: 3;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        padding: 0 15%;
        text-align: center;
        color: #ffffff;
        font-size: 1.4vw;
        line-height: 1.6;
        text-shadow: 0 2px 8px rgba(0, 0, 0, 1);
    }
    .no-games::before {
        content: '';
        position: absolute;
        inset: 10%;
        background: url(../assets/splash_screen_arcade.png) center / contain no-repeat;
        opacity: 0.18;
        pointer-events: none;
    }
    .no-games > * {
        position: relative;
    }
    .no-games h1 {
        color: #fff513;
        font-family: 'Arcade_I', sans-serif;
        font-size: 2.5vw;
        text-shadow: 0 0 30px rgba(237, 106, 10, 0.8), 0 3px 0 rgb(255, 81, 0), 0 12px 16px rgba(0, 0, 0, 1);
    }

    .categoryTitle {
        bottom: 10px;
        background: none;
        transition: opacity .3s ease;
    }
    /* While the scores table is up, the category label at the bottom would be drawn over its last
       row (it sits above it, z-index 2): put it behind the table (z-index 0, and the table comes
       later in the DOM) and fade it out until it is barely visible. Back to normal when the table
       is hidden again. */
    .categoryTitle.behind-hiscores {
        z-index: 0;
        opacity: 0.15;
    }

    .gameTitle > * {
        transform: rotateX(15deg) rotateY(0deg) rotateZ(0deg);
    }

    .categoryTitle > * {
        font-size: 0.5em;
    }

    .gameTitle p {
        line-height: 3em;
        font-size: 1vw;
    }

    .slide-leave-active {
        transition: margin-bottom .3s ease-in 0s;
    }

    .slide-enter-active {
        transition: margin-bottom .3s ease-out 0s;
    }

    .slide-enter-from, .slide-leave-to {
        margin-bottom: -100%;
    }

    .flyer-container {
        position: absolute;
        right: -3%;
        top: -5%;
        bottom: -5%;
        width: 40%;
    }

    .flyer {
        width: 100%;
        height: 100%;
        transform: rotateZ(-4deg);
        background-repeat: no-repeat;
        background-size: cover;
    }

    .flyer-enter-from, .flyer-leave-to {
        margin-right: -100%;
    }

    .games-enter-from, .games-leave-to {
        margin-left: -100%;
    }

    .flyer-leave-active, .games-leave-active, .title-leave-active, .category-leave-active {
        transition: all .3s ease-in 0s;
    }

    .flyer-enter-active, .games-enter-active, .title-enter-active, .category-enter-active {
        transition: all .3s ease-out 0s;
    }

    .title-enter-from, .title-leave-to {
        margin-top: -100%;
    }

    .category-enter-from, .category-leave-to {
        margin-bottom: -100%;
    }

    loader {
        position: absolute;
        top: 10%;
        left: 50%;
    }
</style>
