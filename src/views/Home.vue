<template>
    <div class="home" :class="{empty: noGames, asleep}">
        <modal v-if="showLoader" :key="loaderTitle">
            <p>{{loaderTitle}}</p>
            <loader :duration="loaderDuration"></loader>
        </modal>

        <modal v-if="notice">
            <p>{{notice}}</p>
        </modal>

        <modal v-if="backOfficeUrl">
            <p>Back office</p>
            <p>{{backOfficeUrl}}</p>
        </modal>


        <user-registration v-if="showAddUser" @quit="showAddUser = false"></user-registration>

        <who-played-modal v-if="whoPlayed" :key="whoPlayed.key" :score="whoPlayed.score" :index="whoPlayed.key" :total="whoPlayed.total" :players="whoPlayed.players"
                          @choose="whoPlayed.answer($event)" @skip="whoPlayed.answer(null)" @expire="whoPlayed.answer(undefined)"></who-played-modal>

        <vote-modal v-if="voteGame" @vote="onVote" @skip="voteGame = null"></vote-modal>

        <update-modal v-if="updateOffer" :version="updateOffer" @answer="onUpdateAnswer"></update-modal>

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
            <SetupChecklist v-if="setupProgress && !setupProgress.finished" :progress="setupProgress"/>
            <template v-else>
                <h1>No games yet</h1>
                <p>Add favorites in MAME, or import a starting pack from <strong>{{boUrl}}</strong></p>
            </template>
        </div>

        <transition name="games">
            <Games v-if="!noGames" :games="games" :selectedGameIndex="selectedGameIndex" v-show="showGames"
                   :mouse="mouseNav" @pick="onGamePick" @wheel="onGamesWheel"></Games>
        </transition>

        <transition name="alpha-jump">
            <ul class="alpha-jump" v-if="alphaJumping">
                <li v-for="letter in letters" :key="letter" :class="{selected: letter === selectedLetter}">{{letter}}</li>
            </ul>
        </transition>

        <transition name="flyer">
            <div class="flyer-container" v-show="showFlyer">
                <div class="flyer" :class="{landscape: flyerLandscape}" v-if="flyer" :style="{backgroundImage: flyer ? 'url(' + flyer + ')' : false}"></div>
            </div>
        </transition>

        <Categories v-if="hasCategories" :categories="categories" :selectedCategoryIndex="selectedCategoryIndex"
                    :mouse="mouseNav" @pick="onCategoryPick" @wheel="onCategoriesWheel"></Categories>

        <transition name="slide">
            <Hiscores :game="selectedGame" :fresh="revealedScores" v-if="hiscoresVisible"></Hiscores>
        </transition>

        <message-band v-if="idle && !asleep && idleMessages.length" :messages="idleMessages" @show="onMessageShown"></message-band>

        <update-progress v-if="updating" :version="updating.version" :step="updating.step" @close="updating = null"></update-progress>
    </div>

</template>

<script setup lang="ts">
import {ref, computed, onMounted, onUnmounted, watch} from 'vue';
import router from '@/router';
import Categories from '@/components/Categories.vue';
import Games from '@/components/Games.vue';
import Gamepads from '@/class/Gamepads.class';
import GameService, {GAMES_BY_TITLE} from '@/class/GameService.class';
import Hiscores from '@/components/Hiscores.vue';
import {useControllable} from '@/composables/useControllable';
import {useBoUrl} from '@/composables/useBoUrl';
import {useSetupProgress} from '@/composables/useSetupProgress';
import SetupChecklist from '@/components/SetupChecklist.vue';
import * as remote from '@electron/remote';
import Game from '@/model/Game.model';
import {
    CarouselCategory, ALL_GAMES_CATEGORY, BEAT_THIS_CATEGORY, isDynamicCategory, isMergedCategory,
} from '@/types/CarouselCategory';
import {buildCarousel, mergeTtlCategories} from '@/class/CarouselCategories';
import {loadBeatThisGames, loadHiscores, onLeaderboardsChanged} from '@/class/LeaderboardSource';
import {freshScores as newScoreKeys} from '@/class/ScoreReveal';
import {join} from 'path';
import {pathToFileURL} from 'url';
import {emitter} from '@/emitter';
import {MAUI_KEYS, HOLD_MS} from '@/class/MauiControls';
import {controlInput, controlKey, getHotkeys, onControlsChanged} from '@/class/MauiControlsRuntime';
import {HOTKEY_HOLD_TITLES, HotkeyEngine, type HotkeyAction} from '@/class/Hotkeys';
import {getJumpIndex, getLetter, getLetters} from '@/class/AlphaJump';
import {getIsInit, getConfiguration, getMameService, getGameService, getHiscoreService, isLite} from '@/services';
import Log from 'electron-log';
import UserRegistration from '@/components/userRegistration.vue';
import Loader from '@/components/Loader.vue';
import Modal from '@/components/Modal.vue';
import VoteModal from '@/components/VoteModal.vue';
import {Vote, VOTE_NEUTRAL, shouldAskVote} from '@/class/GameVote';
import WhoPlayedModal from '@/components/WhoPlayedModal.vue';
import {
    PLAY_ENDED_GLOBAL, PLAY_STARTED_GLOBAL, SCORE_ATTRIBUTE_GLOBAL,
    type PendingAttribution, type PlayEndNotifier, type PlayNotifier, type ScoreAttributor,
} from '@/class/ScoreCaptureBridge';
import {BO_WAKE_GLOBAL, type BoWaker} from '@/class/BoWakeBridge';
import {SHUTDOWN_GLOBAL, type ShutdownRequest} from '@/class/KioskPowerBridge';
import {SHOW_GAME_CHANNEL} from '@/class/FrontShowGameBridge';
import {FAVORITES_CHANGED_CHANNEL} from '@/class/FrontFavoritesBridge';
import {UI_SOUNDS_CHANGED_CHANNEL, UI_SOUNDS_TEST_CHANNEL} from '@/class/FrontUiSoundsBridge';
import {uiSounds, uiSoundSettings, voteSound, type UiSoundToggle} from '@/class/UiSounds';
import {isBoMameRunning, onBoMameChanged} from '@/class/BoMameSession';
import {readRemovedFavorites, removeReturnedFavorites} from '@/class/FavoritesStore';
import {ipcRenderer} from 'electron';
import MessageBand from '@/components/MessageBand.vue';
import {IdleWatch} from '@/class/IdleWatch';
import {canSwitchScreenOff, setScreenPower} from '@/class/ScreenPower';
import {scoreEventMessages, updateNoticeMessage, type BandMessage} from '@/class/CabinetMessages';
import {UPDATE_NOTICE_GLOBAL, type UpdateNoticeReader} from '@/class/UpdateNoticeBridge';
import {
    FRONT_UPDATE_GLOBAL, UPDATE_PROGRESS_CHANNEL, type FrontUpdateControl, type UpdateStep,
} from '@/class/FrontUpdateBridge';
import UpdateModal from '@/components/UpdateModal.vue';
import UpdateProgress from '@/components/UpdateProgress.vue';
import {createOnlineClient} from '@/class/OnlineClient';

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
    showGame?: number,
    showFlyer?: number,
    hideBackOffice?: number,
    hideNotice?: number,
    hold?: number,
    holdRepeat?: number,
    roll?: number,
    hideReveal?: number,
} = {};

// The scores a game just played added to its leaderboard (ScoreReveal.ts): the hiscores panel
// opens a few seconds to show them, once the questions after the game are answered and while the
// list is still on that game. The leaderboard as it was at the launch, and until when (after the
// game ended) its changes are still looked for: ONLINE ones come back from MAUI-API a little later.
const REVEAL_SHOWN_MS = 6000;
const REVEAL_WATCH_MS = 2 * 60_000;
let revealWatch: {game: Game; before: string[]; until: number} | null = null;
let pendingReveal: {romName: string; keys: string[]} | null = null;
// The rows Hiscores.vue draws as new (Hiscores.vue's `fresh`).
const revealedScores = ref<string[]>([]);

// How long a game or category change waits for the leaving elements to slide out: nothing slides
// in Lite mode.
const SLIDE_OUT_MS = isLite() ? 0 : 300;

const showHiscores = ref(false);
const flyersPath = ref('');
const flyers = ref<string[]>([]);
const flyer = ref('');
// A landscape flyer is turned 90 degrees to the left to fill the tall flyer area (see .flyer.landscape)
const flyerLandscape = ref(false);

// The column of initials, up while up or down is held in "All games" or "Hiscores only" (see startHold()).
const alphaJumping = ref(false);
const letters = computed(() => getLetters(games.value.map(game => game.shortname)));
const selectedLetter = computed(() => selectedGame.value ? getLetter(selectedGame.value.shortname) : '');

const showGames = ref(true);
const showTitle = ref(true);
const showFlyer = ref(true);
const showLoader = ref(false);
const showAddUser = ref(false);
// The game whose vote is being asked, right after it was quit (see askVote()).
const voteGame = ref<Game | null>(null);
// The newer version of MAUI offered when the cabinet wakes up from idle (see offerUpdate()), then
// its installation, followed step by step until MAUI restarts (FrontUpdate.ts).
const updateOffer = ref<string | null>(null);
const updating = ref<{version: string, step: UpdateStep} | null>(null);
// The nameless score being asked about, right after the game was quit (see askWhoPlayed()).
// `answer` takes the player picked, null when nobody claims the score, undefined when the
// question was cancelled or nobody answered at all.
const whoPlayed = ref<{
    key: number,
    score: number,
    total: number,
    players: PendingAttribution['players'],
    answer: (playerId: string | null | undefined) => void,
} | null>(null);
// Set once the first game list is loaded: an empty list then means no game on the cabinet at all
// (no favorite yet), shown as a message instead of an empty screen.
const gamesLoaded = ref(false);
const boUrl = useBoUrl();
// No game at all: the message replaces the carousel (and its blue selection band).
const noGames = computed(() => gamesLoaded.value && !games.value.length);
// No game yet on a new cabinet: the setup guide's steps instead of a bare message (Lot VI.3).
const setupProgress = useSetupProgress();

// The BO's address on the local network, while it is shown (see showBackOffice()).
const backOfficeUrl = ref('');
const BACK_OFFICE_SHOWN_MS = 15000;
// A line a hotkey has to say ("Shutting down…", or why it did nothing), and how long it stays.
const notice = ref('');
const NOTICE_SHOWN_MS = 8000;
// Nobody at the controls for a while (IdleWatch.ts): the cabinet shows its messages, its latest
// best scores, until the next key - which only takes them away.
const IDLE_MESSAGES = 20;
const idle = ref(false);
const idleMessages = ref<BandMessage[]>([]);
// Switched off in the BO: a delay of 0, the cabinet never turns idle.
const idleDelayMs = getConfiguration().frontIdleEnabled ? getConfiguration().frontIdleMinutes * 60_000 : 0;
// Left alone longer, the cabinet falls asleep: a black screen, nothing left moving, and the screen
// itself off on a dedicated cabinet (ScreenPower.ts) unless the BO says not to.
const asleep = ref(false);
const screenOff = getConfiguration().frontSleepScreenOff && canSwitchScreenOff(remote.app.isPackaged);
const idleWatch = new IdleWatch(idleDelayMs, (isIdle) => {
    idle.value = isIdle;
    if (isIdle) {
        void loadIdleMessages();
    }
}, {
    delayMs: getConfiguration().frontSleepMinutes * 60_000,
    onChange: (isAsleep) => {
        asleep.value = isAsleep;
        if (isAsleep) {
            stopRoll();
            uiSounds.release();
        } else {
            uiSounds.play('wake');
        }
        if (screenOff) {
            // A keyboard key wakes the screen by itself, a gamepad button only through this.
            setScreenPower(!isAsleep).catch((err: unknown) => {
                Log.warn('[Home] Screen not switched ' + (isAsleep ? 'off' : 'on') + ': '
                    + (err instanceof Error ? err.message : String(err)));
            });
        }
    },
});

function readAvailableUpdate(): string | null {
    try {
        const read = remote.getGlobal(UPDATE_NOTICE_GLOBAL) as UpdateNoticeReader | undefined;
        return read ? read() : null;
    } catch {
        return null;
    }
}

function frontUpdate(): FrontUpdateControl | undefined {
    try {
        return remote.getGlobal(FRONT_UPDATE_GLOBAL) as FrontUpdateControl | undefined;
    } catch {
        return undefined;
    }
}

/** On waking up from idle: the newer version of MAUI, when the BO lets the front install it. */
function offerUpdate() {
    try {
        updateOffer.value = frontUpdate()?.offer() ?? null;
    } catch (err) {
        Log.warn('[Home] Update offer not read: ' + (err instanceof Error ? err.message : String(err)));
    }
}

function onUpdateAnswer(install: boolean) {
    const version = updateOffer.value;
    updateOffer.value = null;
    const control = frontUpdate();
    if (!version || !control) {
        return;
    }
    if (!install) {
        control.decline(version);
        return;
    }
    // The main process only installs the version it offers: false when it changed meanwhile.
    if (control.install(version)) {
        updating.value = {version, step: {step: 'download', doneBytes: 0, totalBytes: 0}};
    }
}

const onUpdateStep = (_event: unknown, step: UpdateStep) => {
    if (step.step === 'restart') {
        uiSounds.play('updated');
    }
    if (updating.value) {
        updating.value = {...updating.value, step};
    }
};

/**
 * Read each time the cabinet turns idle: MAUI-API's latest score events in ONLINE mode, else, or
 * when there is none to read, the cabinet's own latest best scores. A newer release of MAUI
 * (UpdateWatch.ts) is announced first, once per idle band. Never throws.
 */
async function loadIdleMessages() {
    try {
        const client = await createOnlineClient();
        const events = client ? await client.getScoreEvents(IDLE_MESSAGES) : null;
        const scores = events?.kind === 'ok' && events.value.length
            ? scoreEventMessages(events.value)
            : await getHiscoreService().loadLatestBests(IDLE_MESSAGES);
        // A newer release of MAUI opens the band, once, before the scores.
        const update = readAvailableUpdate();
        idleMessages.value = update
            ? [updateNoticeMessage(update, frontUpdate()?.offer() === update), ...scores]
            : scores;
    } catch (err) {
        idleMessages.value = [];
        Log.warn('[Home] Messages not loaded: ' + (err instanceof Error ? err.message : String(err)));
    }
}

// Keys of the two-key long press currently held down.
// A game is being launched or runs: the front takes no input, keyboard or controller, until it
// is quit (see lockFront()).
let gameRunning = false;
// The BO changed the favorites while a game was running: synced once it is quit (see
// syncFavorites()).
let favoritesChangedDuringGame = false;

const loaderDuration = ref(2);
const loaderTitle = ref('Button pressing');

const selectedGame = computed(() => games.value[selectedGameIndex.value] || null);

const category = computed(() => categories.value[displayedCategoryIndex.value]);

// A single entry (no genre yet, or everything else hidden from the BO) is nothing to browse.
const hasCategories = computed(() => categories.value.length > 1);

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

// Known once the image is loaded: until then the flyer keeps its previous orientation (it is hidden
// while the game changes anyway, see onGameChange()).
watch(flyer, (url) => {
    if (!url) {
        flyerLandscape.value = false;
        return;
    }
    const image = new Image();
    image.onload = () => {
        if (flyer.value === url) {
            flyerLandscape.value = image.naturalWidth > image.naturalHeight;
        }
    };
    image.src = url;
});

function showSelectedFlyer() {
    flyer.value = generateFlyerPath();
    showFlyer.value = true;
}

function selectGame(index: number) {
    showFlyer.value = false;
    clearTimeout(timeouts.showFlyer);
    // While the list moves by itself (a held key), the flyer waits for it to stop: stopHold().
    if (timeouts.holdRepeat === undefined) {
        timeouts.showFlyer = window.setTimeout(showSelectedFlyer, SLIDE_OUT_MS);
    }
    selectedGameIndex.value = index;
}

function onGameChange(previous: boolean) {
    uiSounds.play('move');
    selectGame(previous ?
        ((selectedGameIndex.value <= 0) ? games.value.length - 1 : selectedGameIndex.value - 1) :
        ((selectedGameIndex.value >= games.value.length - 1) ? 0 : selectedGameIndex.value + 1));
}

/**
 * Up or down kept held: after HOLD_MS.delay the list moves by itself until the key is released.
 * In "All games" and "Hiscores only" it jumps from one initial of the titles to the next, the
 * initials the list has shown on the left; any other category scrolls its games fast.
 */
function startHold(previous: boolean) {
    stopHold();
    timeouts.hold = window.setTimeout(() => {
        timeouts.hold = undefined;
        if (games.value.length < 2) {
            return;
        }
        const selected = categories.value[selectedCategoryIndex.value];
        const alpha = !!selected && isDynamicCategory(selected)
            && (selected.dynamic === 'all' || selected.dynamic === 'hiscores');
        const step = () => {
            if (!alpha) {
                onGameChange(previous);
                return;
            }
            uiSounds.play('alphaJump');
            selectGame(getJumpIndex(games.value.map(game => game.shortname), selectedGameIndex.value, previous));
        };
        alphaJumping.value = alpha;
        timeouts.holdRepeat = window.setInterval(step, alpha ? HOLD_MS.alphaJump : HOLD_MS.fastScroll);
        step();
    }, HOLD_MS.delay);
}

function stopHold() {
    clearTimeout(timeouts.hold);
    timeouts.hold = undefined;
    alphaJumping.value = false;
    if (timeouts.holdRepeat !== undefined) {
        clearInterval(timeouts.holdRepeat);
        timeouts.holdRepeat = undefined;
        clearTimeout(timeouts.showFlyer);
        timeouts.showFlyer = window.setTimeout(showSelectedFlyer, SLIDE_OUT_MS);
    }
}

async function loadCategoryGames(categoryIndex: number): Promise<Game[]> {
    const selected = categories.value[categoryIndex];
    if (isDynamicCategory(selected)) {
        switch (selected.dynamic) {
        case 'all':
            return await gameService.loadGames();
        case 'hiscores':
            return await gameService.loadHiscoreGames();
        case 'beat-this':
            return await loadBeatThisGames();
        case 'starred':
            return await gameService.loadStarredGames();
        }
    }
    if (isMergedCategory(selected)) {
        return await gameService.loadGamesByCategoryIds(selected.categoryIds);
    }
    return await selected.$get('games', {order: GAMES_BY_TITLE}) as Game[] || [];
}

function onCategoryChange(previous: boolean) {
    goToCategory(previous ?
        ((selectedCategoryIndex.value <= 0) ? categories.value.length - 1 : selectedCategoryIndex.value - 1) :
        ((selectedCategoryIndex.value >= categories.value.length - 1) ? 0 : selectedCategoryIndex.value + 1));
}

function goToCategory(index: number) {
    stopHold();
    uiSounds.play('category');
    const showGameFn = async () => {
        // The title finished sliding out (showTitle is false since the switch started): swap its
        // text now, it slides back in with the new name once the games are loaded below.
        displayedCategoryIndex.value = selectedCategoryIndex.value;
        // Every list in GAMES_BY_TITLE's order, the one of "All games": without it, $get('games')
        // falls back to SQLite's unspecified row order, and a game's position within its category
        // no longer matches where it sits in the full list.
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
    timeouts.showGame = window.setTimeout(showGameFn, SLIDE_OUT_MS);
    selectedCategoryIndex.value = index;
}

/**
 * Windowed mode only (a cabinet's fullscreen front is played with its controls): the mouse
 * wheel over the list of games or over the categories moves them, a click picks a game (and
 * launches the one already selected) or a category. Nothing while a game or a question is up;
 * the first touch of an idle front only wakes it, like a key.
 */
const mouseNav = !getConfiguration().fullscreen;
// Wheel travel not yet turned into a move, per area, and when each last moved: a trackpad sends
// many small deltas, a wheel notch one big one.
const wheel = {games: {travel: 0, at: 0}, categories: {travel: 0, at: 0}};
const WHEEL_STEP_PX = 60;
// The categories slide out and back in: one move at a time is enough.
const WHEEL_INTERVAL_MS = {games: 60, categories: SLIDE_OUT_MS};

function mouseAllowed(): boolean {
    if (idleWatch.activity()) {
        stopRoll();
        return false;
    }
    return !gameRunning && !showAddUser.value && !whoPlayed.value && !voteGame.value && !backOfficeUrl.value;
}

/** -1 (up), 1 (down) or 0 once `e` adds up to a step for `area`. */
function wheelStep(e: WheelEvent, area: 'games' | 'categories'): number {
    const state = wheel[area];
    // Lines (a mouse on some systems) or pixels (most).
    state.travel += e.deltaMode === 1 ? e.deltaY * 20 : e.deltaY;
    if (Math.abs(state.travel) < WHEEL_STEP_PX || Date.now() - state.at < WHEEL_INTERVAL_MS[area]) {
        return 0;
    }
    const step = Math.sign(state.travel);
    state.travel = 0;
    state.at = Date.now();
    return step;
}

function onGamesWheel(e: WheelEvent) {
    if (!mouseNav || !mouseAllowed() || games.value.length < 2) {
        return;
    }
    const step = wheelStep(e, 'games');
    if (step) {
        onGameChange(step < 0);
    }
}

function onCategoriesWheel(e: WheelEvent) {
    if (!mouseNav || !mouseAllowed() || !hasCategories.value) {
        return;
    }
    const step = wheelStep(e, 'categories');
    if (step) {
        onCategoryChange(step < 0);
    }
}

function onGamePick(index: number) {
    if (!mouseAllowed()) {
        return;
    }
    if (index === selectedGameIndex.value) {
        startGame();
    } else {
        selectGame(index);
    }
}

function onCategoryPick(index: number) {
    if (mouseAllowed() && index !== selectedCategoryIndex.value) {
        goToCategory(index);
    }
}

/** Never throws: ONLINE must never keep a game from starting. */
async function notifyScoreCapture(romName: string, reportDir: string | null): Promise<void> {
    try {
        const notify = remote.getGlobal(PLAY_STARTED_GLOBAL) as PlayNotifier | undefined;
        await notify?.(romName, reportDir);
    } catch (err) {
        Log.warn('[Home] Score capture not notified: ' + (err instanceof Error ? err.message : String(err)));
    }
}

/** The game ended: the nameless scores to ask about, null when there is none. Never throws. */
async function endScoreCapture(romName: string): Promise<PendingAttribution | null> {
    try {
        const notify = remote.getGlobal(PLAY_ENDED_GLOBAL) as PlayEndNotifier | undefined;
        const pending = await notify?.(romName);
        return pending ? JSON.parse(pending) as PendingAttribution : null;
    } catch (err) {
        Log.warn('[Home] Score capture not notified: ' + (err instanceof Error ? err.message : String(err)));
        return null;
    }
}

/**
 * Asks who made each score the game wrote without a name, best first, and tells the main process
 * (ScoreCapture.attribute()). Once it is cancelled or nobody answers, the scores left are dropped
 * without asking.
 * Never throws.
 */
async function askWhoPlayed(pending: PendingAttribution | null) {
    if (!pending) {
        return;
    }
    let expired = false;
    for (const [key, {score}] of pending.scores.entries()) {
        const playerId = expired ? undefined : await new Promise<string | null | undefined>((resolve) => {
            whoPlayed.value = {key, score, total: pending.scores.length, players: pending.players, answer: resolve};
        });
        whoPlayed.value = null;
        expired = playerId === undefined;
        try {
            const attribute = remote.getGlobal(SCORE_ATTRIBUTE_GLOBAL) as ScoreAttributor | undefined;
            await attribute?.(pending.romname, score, playerId ?? null);
        } catch (err) {
            Log.warn('[Home] Score not attributed: ' + (err instanceof Error ? err.message : String(err)));
        }
    }
}

/**
 * From the moment a game is launched: no key or button acts on the front, whose controllers are
 * no longer read, and anything a held key had started is dropped. A second press on the launch
 * key while the first game is starting is ignored the same way.
 */
function lockFront() {
    gameRunning = true;
    syncIdleBlock();
    stopHold();
    hotkeys.reset();
    Gamepads.suspend();
}

function unlockFront() {
    gameRunning = false;
    syncIdleBlock();
    Gamepads.resume();
}

/**
 * The front is not left alone while a game runs (launched here or from the BO), a modal is up or
 * there is no game to show.
 */
function syncIdleBlock() {
    stopRoll();
    idleWatch.block(gameRunning || isBoMameRunning() || showAddUser.value || !!whoPlayed.value || !!voteGame.value
        || !!updateOffer.value || !!updating.value || !!backOfficeUrl.value || noGames.value);
}

function startGame() {
    const mameService = getMameService();
    const hiService = getHiscoreService();
    const game = selectedGame.value;
    if (!game || gameRunning) {
        return;
    }
    lockFront();
    // ONLINE: the table as it is before the game, so that only its new scores are sent.
    // The capture daemon's directory first: the game's report on itself goes with its scores.
    const capture = mameService.prepareCapture(game.romName);
    void watchScoreReveal(game);
    // The launch sound, then the sound card let go for MAME (UiSounds.ts).
    void uiSounds.playThenSuspend('launch').then(() => notifyScoreCapture(game.romName, capture?.dir ?? null))
        .then(() => mameService.startGame(game.romName, capture)).then(
        (gameProcess) => {
            getGameService().recordLaunch(game.romName).catch((err) => {
                Log.error('[Home] Error on game ' + game.id_game + ' launch recording.');
                Log.error(err);
            });
            // A game that could not even start (mame missing) may only say so here.
            gameProcess.on('error', () => {
                uiSounds.resume();
                unlockFront();
                // ONLINE waits for the end of the game (OnlineSession.pause()): it never came.
                void endScoreCapture(game.romName);
            });
            gameProcess.on('close', () => {
                // Before the questions asked after a game (who played, vote), answered with the
                // controller.
                unlockFront();
                uiSounds.resume();
                uiSounds.play('back');
                const pending = endScoreCapture(game.romName);
                // The cabinet's best score on the game before and after it: a fanfare when it went up.
                hiService.loadCabinetBest(game).then(async (bestBefore) => {
                    await hiService.saveHiscores(game);
                    return bestBefore;
                }).then(async (bestBefore) => {
                    emitter.emit('game-quit');
                    if (favoritesChangedDuringGame) {
                        await syncFavorites();
                    }
                    await onScoresChanged();
                    if (await hiService.loadCabinetBest(game) > bestBefore) {
                        await uiSounds.playAndWait('champion');
                    }
                    await askWhoPlayed(await pending);
                    await askVote(game);
                    return checkScoreReveal();
                }).catch((err) => {
                    Log.error('[Home] Error after game ' + game.id_game + ' quit.');
                    Log.error(err);
                });
            });
        },
        (err) => {
            uiSounds.resume();
            unlockFront();
            void endScoreCapture(game.romName);
            Log.error('[Home] Error on game ' + game.id_game + ' launch.');
            Log.error(err);
        },
    );
}

/** The leaderboard of a game being launched, to tell its new scores once it is quit. Never throws. */
async function watchScoreReveal(game: Game) {
    revealWatch = null;
    pendingReveal = null;
    if (!game.hi) {
        return;
    }
    try {
        const before = (await loadHiscores(game)).map(row => row.key);
        revealWatch = {game, before, until: Infinity};
    } catch (err) {
        Log.warn('[Home] Leaderboard not read before the game: ' + (err instanceof Error ? err.message : String(err)));
    }
}

/**
 * After a game, and each time the leaderboards change for a little while after it: the scores the
 * game added are shown (revealScores()). Never throws.
 */
async function checkScoreReveal() {
    const watch = revealWatch;
    if (!watch || gameRunning) {
        return;
    }
    if (watch.until === Infinity) {
        watch.until = Date.now() + REVEAL_WATCH_MS;
    } else if (Date.now() > watch.until) {
        revealWatch = null;
        return;
    }
    try {
        const rows = await loadHiscores(watch.game);
        const keys = newScoreKeys(watch.before, rows);
        if (!keys.length) {
            return;
        }
        // Shown once: a later change is compared to what is on the board now.
        watch.before = rows.map(row => row.key);
        pendingReveal = {romName: watch.game.romName, keys: [...(pendingReveal?.keys ?? []), ...keys]};
        revealScores();
    } catch (err) {
        Log.warn('[Home] Leaderboard not read after the game: ' + (err instanceof Error ? err.message : String(err)));
    }
}

/**
 * Opens the hiscores panel REVEAL_SHOWN_MS with the new scores drawn as such, then closes it again
 * (unless it was open already). Waits for the questions after the game and any other modal; given
 * up when the list moved to another game meanwhile.
 */
function revealScores() {
    const reveal = pendingReveal;
    if (!reveal || gameRunning || asleep.value || showAddUser.value || whoPlayed.value || voteGame.value
        || updateOffer.value || updating.value || backOfficeUrl.value) {
        return;
    }
    pendingReveal = null;
    if (selectedGame.value?.romName !== reveal.romName) {
        return;
    }
    const wasShown = showHiscores.value && !timeouts.hideReveal;
    revealedScores.value = reveal.keys;
    showHiscores.value = true;
    clearTimeout(timeouts.hideReveal);
    timeouts.hideReveal = window.setTimeout(() => {
        timeouts.hideReveal = undefined;
        revealedScores.value = [];
        if (!wasShown) {
            showHiscores.value = false;
        }
    }, REVEAL_SHOWN_MS);
}

/**
 * Once a game is quit: ask the vote, unless it was already given (a thumbs up / down is final)
 * or the BO turned the prompt off.
 */
async function askVote(game: Game) {
    // Removed from the BO while it was played: it has left the cabinet, its vote with it.
    if (isRemovedFavorite(game.romName)) {
        return;
    }
    // Both the setting and the vote itself can have been changed from the BO since this game was
    // loaded: read them again.
    const config = getConfiguration();
    config.load();
    await game.reload();
    if (shouldAskVote(game, config.voteEnabled)) {
        voteGame.value = game;
    }
}

async function onVote(vote: Vote, starred: boolean) {
    const game = voteGame.value;
    voteGame.value = null;
    const sound = game && voteSound(vote, starred);
    if (sound) {
        uiSounds.play(sound);
    }
    if (!game || vote === VOTE_NEUTRAL) {
        // Neutral is the vote of a game nobody voted on: nothing to save, it is asked again.
        return;
    }
    try {
        const removed = await gameService.applyVote(game, vote, getConfiguration().thumbsDownRemovesFavorite, starred);
        // A star: "My favourites" comes into the carousel with its first game, or gets one more.
        if (removed || starred) {
            await reloadCarousel();
        }
    } catch (err) {
        Log.error('[Home] Error on game ' + game.id_game + ' vote.');
        Log.error(err);
    }
}

function isRemovedFavorite(romName: string): boolean {
    return readRemovedFavorites().some(removed => removed.romName === romName);
}

/**
 * The BO took a game out of the favorites or put one back (FrontFavoritesBridge.ts): the games
 * follow favorites.ini and the carousel is built again. Waits for the game being played to be
 * quit - MAME writes favorites.ini back on exit, removed games included, hence
 * removeReturnedFavorites() as on a start (Init.vue). A vote asked for a game just removed is
 * dropped.
 */
async function syncFavorites() {
    if (gameRunning) {
        favoritesChangedDuringGame = true;
        return;
    }
    favoritesChangedDuringGame = false;
    if (voteGame.value && isRemovedFavorite(voteGame.value.romName)) {
        voteGame.value = null;
    }
    try {
        const mameService = getMameService();
        if (mameService.favoritesPath) {
            removeReturnedFavorites(mameService.favoritesPath);
        }
        await gameService.saveGamesFromRomNames(mameService.getRomListFromFavorites());
        await reloadCarousel();
    } catch (err) {
        Log.error('[Home] Error on favorites sync.');
        Log.error(err);
    }
}

/**
 * Builds the carousel again and keeps the selection where it was: a game left the favorites
 * (its category may have gone with it), or the scores changed.
 */
async function reloadCarousel() {
    const selectedId = categories.value[selectedCategoryIndex.value]?.id_category;
    const selectedRomName = selectedGame.value?.romName;
    await loadCategories();
    // The category the game was in had no other game, and left the carousel: back to the first.
    const index = Math.max(categories.value.findIndex(entry => entry.id_category === selectedId), 0);
    selectedCategoryIndex.value = index;
    displayedCategoryIndex.value = index;
    const loadedGames = await loadCategoryGames(index);
    games.value = loadedGames;
    // The same game when it is still there ("Beat This!" changes its order), else the same
    // position.
    const gameIndex = loadedGames.findIndex(loaded => loaded.romName === selectedRomName);
    selectedGameIndex.value = gameIndex >= 0
        ? gameIndex
        : Math.min(selectedGameIndex.value, Math.max(loadedGames.length - 1, 0));
    flyer.value = generateFlyerPath();
}

// Games the list rolls through before it stops on the one an idle cabinet's message is about.
const ROLL_GAMES = 10;

/** The list stops rolling where it is (see showGame()), and shows the flyer of the game it is on. */
function stopRoll() {
    if (timeouts.roll !== undefined) {
        clearInterval(timeouts.roll);
        timeouts.roll = undefined;
        showSelectedFlyer();
    }
}

/** The message an idle cabinet starts showing: the front goes to its game, when it has it. */
// Switched off in the BO: the list stays where it was behind the curtain.
const idleShowsGames = getConfiguration().frontIdleShowsGames;
function onMessageShown(message: BandMessage) {
    if (idle.value && idleShowsGames && message.romName) {
        void showGame(message.romName, true);
    }
}

/**
 * The BO asks for a game on screen (Favorites tab): its own category when the carousel has it,
 * else the first one that lists it ("All games"...). Left alone while a game is being played or a
 * question is up, and when no category has the game.
 *
 * announced: the game of an idle cabinet's message instead. "All games" first, the other
 * categories only when it is hidden, and the list rolls its last games up to that one, as a
 * player would bring it there (it jumps straight to it in Lite mode).
 */
async function showGame(romName: string, announced = false) {
    if (getMameService().isGameStarted || showAddUser.value || whoPlayed.value || voteGame.value) {
        return;
    }
    stopHold();
    stopRoll();
    try {
        // By its kind, not by identity: the carousel's entries are reactive proxies.
        const isAllGames = (index: number) => {
            const entry = categories.value[index];
            return isDynamicCategory(entry) && entry.dynamic === ALL_GAMES_CATEGORY.dynamic;
        };
        const order = categories.value.map((_, index) => index).sort((a, b) => announced
            ? Number(isAllGames(b)) - Number(isAllGames(a))
            : Number(isDynamicCategory(categories.value[a])) - Number(isDynamicCategory(categories.value[b])));
        for (const index of order) {
            const loadedGames = await loadCategoryGames(index);
            const gameIndex = loadedGames.findIndex(loaded => loaded.romName === romName);
            if (gameIndex < 0) {
                continue;
            }
            clearTimeout(timeouts.showGame);
            clearTimeout(timeouts.showFlyer);
            showHiscores.value = false;
            selectedCategoryIndex.value = index;
            displayedCategoryIndex.value = index;
            games.value = loadedGames;
            showGames.value = true;
            showTitle.value = true;
            // The cabinet woke up while the games were being read: nothing rolls under the player.
            const rolls = announced && idle.value && !isLite();
            // From above the game, or from below one too near the top of the list.
            const step = gameIndex >= ROLL_GAMES ? 1 : -1;
            const start = rolls ? Math.min(Math.max(gameIndex - step * ROLL_GAMES, 0), loadedGames.length - 1) : gameIndex;
            selectedGameIndex.value = start;
            if (start === gameIndex) {
                flyer.value = generateFlyerPath();
                showFlyer.value = true;
                return;
            }
            showFlyer.value = false;
            timeouts.roll = window.setInterval(() => {
                selectedGameIndex.value += step;
                if (selectedGameIndex.value === gameIndex) {
                    stopRoll();
                }
            }, HOLD_MS.fastScroll);
            return;
        }
    } catch (err) {
        Log.error('[Home] Error on showing game ' + romName + '.');
        Log.error(err);
    }
}

/**
 * New scores (a game was quit, or MAUI-API's leaderboards changed): "Beat This!" may have
 * to appear, or to put another game first. Nothing is touched otherwise.
 */
async function onScoresChanged() {
    if (!getConfiguration().showBeatThisCategory) {
        return;
    }
    try {
        const beatThis = (await loadBeatThisGames()).length > 0;
        const selected = categories.value[selectedCategoryIndex.value];
        if (beatThis !== categories.value.includes(BEAT_THIS_CATEGORY) || selected === BEAT_THIS_CATEGORY) {
            await reloadCarousel();
        }
    } catch (err) {
        Log.error('[Home] Error on carousel refresh.');
        Log.error(err);
    }
}

async function loadCategories() {
    const config = getConfiguration();
    categories.value = buildCarousel(mergeTtlCategories(await gameService.loadCategories()), {
        showAllGames: config.showAllGamesCategory,
        showBeatThis: config.showBeatThisCategory,
        showHiscoresOnly: config.showHiscoresOnlyCategory,
        hasStarredGames: (await gameService.loadStarredGames()).length > 0,
        hasBeatThisGames: config.showBeatThisCategory && (await loadBeatThisGames()).length > 0,
        hasHiscoreGames: config.showHiscoresOnlyCategory && (await gameService.loadHiscoreGames()).length > 0,
    });
}

/**
 * Loads the BO, which is not kept in memory on a cabinet nobody is setting up (boCore.ts), and
 * shows where to reach it.
 */
async function showBackOffice() {
    clearTimeout(timeouts.hideBackOffice);
    showHiscores.value = false;
    let url = boUrl.value;
    try {
        const wake = remote.getGlobal(BO_WAKE_GLOBAL) as BoWaker | undefined;
        url = wake ? await wake() : boUrl.value;
    } catch (err) {
        Log.warn('[Home] Back office not woken: ' + (err instanceof Error ? err.message : String(err)));
    }
    backOfficeUrl.value = url;
    timeouts.hideBackOffice = window.setTimeout(() => {
        backOfficeUrl.value = '';
    }, BACK_OFFICE_SHOWN_MS);
}

/** What a hotkey of the BO's Controls tab does once it goes off (Hotkeys.ts). */
function runHotkey(action: HotkeyAction) {
    switch (action) {
    case 'backOffice':
        void showBackOffice();
        break;
    case 'quit':
        remote.app.quit();
        break;
    case 'newPlayer':
        showAddUser.value = true;
        break;
    case 'shutdown':
        void shutDown();
        break;
    }
}

function showNotice(text: string, hideAfterMs?: number) {
    clearTimeout(timeouts.hideNotice);
    notice.value = text;
    if (hideAfterMs) {
        timeouts.hideNotice = window.setTimeout(() => {
            notice.value = '';
        }, hideAfterMs);
    }
}

/** A dedicated cabinet goes down (KioskRestart.ts powerOff()); anywhere else, or without the right, says why not. */
async function shutDown() {
    showNotice('Shutting down…');
    let refused: string | null;
    try {
        const request = remote.getGlobal(SHUTDOWN_GLOBAL) as ShutdownRequest | undefined;
        refused = request ? await request() : 'Shutting down is not available.';
    } catch (err) {
        refused = err instanceof Error ? err.message : String(err);
    }
    if (refused) {
        showNotice(refused, NOTICE_SHOWN_MS);
    }
}

// Turns the keys pressed on the list of games into what they do: a hotkey, or a key's own job
// (onListKeyDown()), a little later for the keys a held or two-key hotkey uses.
const hotkeys = new HotkeyEngine(getHotkeys(), {
    keyDown: key => onListKeyDown(key),
    keyUp: key => onListKeyUp(key),
    action: runHotkey,
    holdStart: (hotkey) => {
        loaderDuration.value = hotkey.holdMs / 1000;
        loaderTitle.value = HOTKEY_HOLD_TITLES[hotkey.action];
        showLoader.value = true;
        uiSounds.startCharge(hotkey.holdMs);
    },
    holdEnd: () => {
        showLoader.value = false;
        uiSounds.stopCharge();
    },
});
const stopHotkeysListener = onControlsChanged(() => hotkeys.setHotkeys(getHotkeys()));
const stopBoMameListener = onBoMameChanged(() => {
    // A MAME the BO launched needs the sound card too (UiSounds.ts).
    if (isBoMameRunning()) {
        uiSounds.suspend();
    } else if (!gameRunning) {
        uiSounds.resume();
    }
    syncIdleBlock();
});

const {onKeydown, onKeyup} = useControllable();

let stopLeaderboardsListener: (() => void) | undefined;
const onShowGame = (_event: unknown, romName: string) => {
    // Asked from the BO: a sleeping cabinet wakes up to show it.
    if (asleep.value) {
        idleWatch.activity();
    }
    void showGame(romName);
};
const onFavoritesChanged = () => void syncFavorites();
const onUiSoundsChanged = () => {
    const config = getConfiguration();
    config.load();
    uiSounds.setSettings(uiSoundSettings(config));
};
const onUiSoundsTest = (_event: unknown, volume: number, sound: UiSoundToggle) => uiSounds.test(volume, sound);
onUnmounted(() => {
    stopLeaderboardsListener?.();
    stopHotkeysListener();
    stopBoMameListener();
    hotkeys.reset();
    ipcRenderer.off(SHOW_GAME_CHANNEL, onShowGame);
    ipcRenderer.off(FAVORITES_CHANGED_CHANNEL, onFavoritesChanged);
    ipcRenderer.off(UI_SOUNDS_CHANGED_CHANNEL, onUiSoundsChanged);
    ipcRenderer.off(UI_SOUNDS_TEST_CHANNEL, onUiSoundsTest);
    ipcRenderer.off(UPDATE_PROGRESS_CHANNEL, onUpdateStep);
    window.removeEventListener('blur', stopHold);
    stopHold();
    stopRoll();
    clearTimeout(timeouts.hideReveal);
    idleWatch.stop();
    if (gameRunning) {
        unlockFront();
    }
});
// A keyboard key released while the window is not focused sends no keyup (Gamepads.class.ts
// sends its own for a controller).
window.addEventListener('blur', stopHold);
window.addEventListener('blur', () => hotkeys.reset());
// A modal takes the keys over: the list stops where it is.
watch(() => showAddUser.value || !!whoPlayed.value || !!voteGame.value || !!updateOffer.value || !!updating.value, (modal) => {
    if (modal) {
        stopHold();
        hotkeys.reset();
        return;
    }
    // New scores waiting for the questions after the game to be answered.
    revealScores();
});
watch(() => [showAddUser.value, !!whoPlayed.value, !!voteGame.value, !!updateOffer.value, !!updating.value,
    !!backOfficeUrl.value, noGames.value], syncIdleBlock);

/** A key's own job on the list of games, as a press. */
function onListKeyDown(key: string) {
    switch (key) {
    case MAUI_KEYS.up:
        onGameChange(true);
        startHold(true);
        break;
    case MAUI_KEYS.down:
        onGameChange(false);
        startHold(false);
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
        break;
    case MAUI_KEYS.enter:
        startGame();
        break;
    }
}

/** A key's own job on the list of games, as a release. */
function onListKeyUp(key: string) {
    if (key === MAUI_KEYS.up || key === MAUI_KEYS.down) {
        stopHold();
    }
}

function registerKeyMapping() {
    onKeydown((e, isGamepad) => {
        // The key that wakes an idle cabinet only takes its messages away, and may bring the
        // offer of a newer version.
        if (idleWatch.activity()) {
            stopRoll();
            offerUpdate();
            return;
        }
        if (gameRunning || showAddUser.value || whoPlayed.value || voteGame.value || updateOffer.value || updating.value) {
            return;
        }
        hotkeys.press({key: controlKey(e, isGamepad), input: controlInput(e, isGamepad)});
    });

    onKeyup((e, isGamepad) => {
        if (gameRunning) {
            return;
        }
        const key = controlKey(e, isGamepad);
        // Before anything else: a list left moving behind a modal would never stop.
        if (key === MAUI_KEYS.up || key === MAUI_KEYS.down) {
            stopHold();
        }
        if (showAddUser.value || whoPlayed.value || voteGame.value) {
            return;
        }
        hotkeys.release({key, input: controlInput(e, isGamepad)});
    });
}

if (!getIsInit()) {
    router.push({name: 'init'});
} else {
    // The window is frameless: in windowed mode, dragging anywhere moves it (App.vue).
    document.documentElement.classList.toggle('window-draggable', !getConfiguration().fullscreen);
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
        games.value = await loadCategoryGames(0);
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
        syncIdleBlock();
        idleWatch.start();
        stopLeaderboardsListener = onLeaderboardsChanged(() => {
            void onScoresChanged();
            // MAUI-API's answer to the game just played: its new scores, if any.
            void checkScoreReveal();
        });
        ipcRenderer.on(SHOW_GAME_CHANNEL, onShowGame);
        ipcRenderer.on(FAVORITES_CHANGED_CHANNEL, onFavoritesChanged);
        ipcRenderer.on(UI_SOUNDS_CHANGED_CHANNEL, onUiSoundsChanged);
        ipcRenderer.on(UI_SOUNDS_TEST_CHANNEL, onUiSoundsTest);
        uiSounds.setSettings(uiSoundSettings(getConfiguration()));
        ipcRenderer.on(UPDATE_PROGRESS_CHANNEL, onUpdateStep);

        flyersPath.value = mameService.flyerPath;
        flyers.value = gameService.loadFlyers();
        flyer.value = generateFlyerPath();
    });
}
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

    /* Asleep: nothing shown, so nothing left to animate or to paint. */
    .home.asleep {
        background: #000000;
    }

    .home.asleep > * {
        display: none !important;
    }

    .gameTitle, .categoryTitle {
        position: absolute;
        width: 100%;
        z-index: 2;
        /* Shown over the list and the categories, which take the mouse in windowed mode. */
        pointer-events: none;
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

    /* The initials of "All games" while up or down is held (startHold()): in the margin the
       marquees leave on the left, over the list. */
    .alpha-jump {
        position: absolute;
        left: 0;
        top: 0;
        bottom: 0;
        width: 4.5vw;
        z-index: 3;
        margin: 0;
        padding: 0;
        list-style: none;
        display: flex;
        flex-direction: column;
        justify-content: center;
        align-items: center;
        background: linear-gradient(to right, rgba(0, 0, 0, 0.75), transparent);
        font-family: 'Arcade_I', sans-serif;
        font-size: 1.1vw;
        color: rgba(255, 255, 255, 0.55);
    }

    .alpha-jump li {
        line-height: 3.3vh;
        transition: transform .15s ease, color .15s ease;
    }

    .alpha-jump li.selected {
        color: #fff513;
        transform: scale(2.2) translateX(0.35vw);
    }

    .alpha-jump-enter-active, .alpha-jump-leave-active {
        transition: opacity .2s ease;
    }

    .alpha-jump-enter-from, .alpha-jump-leave-to {
        opacity: 0;
    }

    .flyer-container {
        position: absolute;
        right: -3%;
        top: -5%;
        bottom: -5%;
        width: 40%;
        /* Size container: lets .flyer.landscape size itself from the container (cqw/cqh) */
        container-type: size;
    }

    .flyer {
        width: 100%;
        height: 100%;
        transform: rotateZ(-4deg);
        background-repeat: no-repeat;
        background-size: cover;
    }

    /* Landscape flyer: the element takes the container's height as its width and the other way
       round, then turns 90 degrees to the left (plus the usual 4 degree tilt) around its center. */
    .flyer.landscape {
        position: absolute;
        top: 50%;
        left: 50%;
        width: 100cqh;
        height: 100cqw;
        transform: translate(-50%, -50%) rotateZ(-94deg);
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
