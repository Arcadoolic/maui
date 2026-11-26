<template>
    <div class="champions" :class="{spring}">
        <!-- From one mode to the next, the podium turns over like a card. -->
        <Transition name="mode-swap" mode="out-in" :css="swapping">
            <div class="board" :key="shownMode?.id ?? 'default'">
                <TransitionGroup tag="div" name="champion" class="championsContainer" :class="{animated}" :css="animated" v-if="champions.length">
                    <div v-for="(champion, index) of champions" :key="champion.player" class="champion" :class="'place-' + (champions.length - index)" :style="{right: (index * 10 + edgeOffset) + '%', '--reach': ((champions.length - index) * SPRING_STEP) + '%'}">
                        <img v-if="champion.avatar" :src="champion.avatar" alt="" :style="{backgroundColor: avatarColor(champion.pseudo3)}">
                        <img v-else src="../assets/defaultPlayer.png" alt="" :style="{backgroundColor: avatarColor(champion.pseudo3)}">
                    </div>
                </TransitionGroup>
                <img v-else class="default" src="../assets/hiscores.svg" alt="">
                <span class="mode" v-if="shownMode">{{shownMode.label}}</span>
            </div>
        </Transition>
    </div>
</template>

<script setup lang="ts">
import {ref, computed, watch, onMounted, onUnmounted} from 'vue';
import Game from '@/model/Game.model';
import {emitter} from '@/emitter';
import {loadChampions, onLeaderboardsChanged, type BoardRow} from '@/class/LeaderboardSource';
import {avatarColor} from '@/class/AvatarColor';
import {useModeTable} from '@/class/ModeRotation';
import type {ModeTable} from '@/class/ModeTables';

const props = defineProps<{game: Game; selected?: boolean}>();
const mode = useModeTable(() => props.game.romName);

// The selected marquee's podium comes to life: as soon as the game is picked, the avatars
// move apart to the right as on an elastic pulled from its left end, then snap back at once and
// bounce a little; the cup rocks on its foot. Once per selection.
const SPRING_DELAY_MS = 0;
const SPRING_MS = 1300;
// How much further each avatar goes than the one on its left, in % of its width (its --reach).
const SPRING_STEP = 35;
const spring = ref(false);
let springTimer: ReturnType<typeof setTimeout> | undefined;

function armSpring() {
    clearTimeout(springTimer);
    spring.value = false;
    if (!props.selected) {
        return;
    }
    springTimer = setTimeout(() => {
        spring.value = true;
        springTimer = setTimeout(() => {
            spring.value = false;
        }, SPRING_MS);
    }, SPRING_DELAY_MS);
}

watch(() => [props.selected, props.game], armSpring);

// The best 3 players (LeaderboardSource.ts), drawn from the 3rd to the 1st.
const champions = ref<BoardRow[]>([]);
// The mode of that podium: set with it, so that the swap starts once it is read.
const shownMode = ref<ModeTable | null>(null);
// Only between the modes of a game.
const swapping = ref(false);
const loading = ref(true);
// Every avatar is drawn astride (centred on its `right`), a step of 10% from the next. One player:
// its centre on the marquee's end; two or three: the 2nd's centre there, the best one a step to
// its left and the 3rd a step to its right. The container (Games.vue's .champions) is as wide as
// the marquee and starts 10% further right: the edge is at right 10%.
const edgeOffset = computed(() => champions.value.length < 3 ? 10 : 0);
let stopListening: (() => void) | null = null;
// New scores (a game was quit, MAUI-API's leaderboards changed): the podium moves in view, a new
// player popping in, the others sliding to their new place, the one pushed off fading out. Not
// when the list scrolls to another game, whose podium simply replaces this one.
const ANIMATION_MS = 1000;
const animated = ref(false);
let stopAnimating: ReturnType<typeof setTimeout> | undefined;

async function reload() {
    const game = props.game;
    const next = mode.value;
    const rows = await loadChampions(game, next?.id);
    // The list or the mode may have moved on while the rows were read.
    if (game === props.game && next?.id === mode.value?.id) {
        champions.value = rows.reverse();
        shownMode.value = next;
    }
}

async function onGameChange() {
    swapping.value = false;
    loading.value = true;
    await reload();
    loading.value = false;
}

async function onScoresChange() {
    animated.value = true;
    clearTimeout(stopAnimating);
    await onGameChange();
    stopAnimating = setTimeout(() => {
        animated.value = false;
    }, ANIMATION_MS);
}

watch(() => props.game, onGameChange);
watch(() => mode.value?.id, () => {
    swapping.value = !loading.value;
    return reload();
});

onMounted(async () => {
    armSpring();
    await onGameChange();

    emitter.on('game-quit', onScoresChange);
    emitter.on('hiscores-loaded', onGameChange);
    stopListening = onLeaderboardsChanged(onScoresChange);
});

// `emitter` is a module-level mitt singleton, so it outlives every component instance that
// subscribes to it. Without this, each mount leaves behind a handler closed over a destroyed
// component's props and refs, and they accumulate for the life of the process. The Vue 2 original
// never called `EventBus.$off` either, but there the bus was a Vue instance torn down with the
// app; here nothing ever removes the handler but this.
onUnmounted(() => {
    emitter.off('game-quit', onScoresChange);
    emitter.off('hiscores-loaded', onGameChange);
    stopListening?.();
    clearTimeout(stopAnimating);
    clearTimeout(springTimer);
});
</script>

<style scoped>
    .board {
        position: relative;
        height: 100%;
        width: 100%;
    }

    .mode-swap-leave-active {
        transition: transform 0.2s ease-in;
    }

    .mode-swap-enter-active {
        transition: transform 0.3s cubic-bezier(0.2, 0.8, 0.3, 1.4);
    }

    .mode-swap-enter-from,
    .mode-swap-leave-to {
        transform: scaleY(0);
    }

    /* The mode of the podium shown, for a game ranking several: written upwards along
       the left of the marquee, outside it (the list leaves that margin to the selected one). The
       container starts 10% right of the marquee's left end (Games.vue's .champions). Sized
       against the marquee's height (cqh), the longest name having to fit in it. */
    .mode {
        position: absolute;
        top: 0;
        bottom: 0;
        right: calc(110% + 3cqh);
        display: flex;
        align-items: center;
        justify-content: center;
        writing-mode: vertical-rl;
        transform: rotate(180deg);
        white-space: nowrap;
        font-family: 'Arcade_I', sans-serif;
        font-size: 11cqh;
        line-height: 1.3;
        text-transform: uppercase;
        color: #fff513;
        /* No background: a shadow keeps it readable over the flyer behind the list. */
        text-shadow: 0 0 4px #000, 0 2px 3px #000;
    }

    /* Sized by Games.vue (the marquee's box): what the avatars' border is measured against. */
    .champions {
        container-type: size;
    }

    .championsContainer {
        height: 100%;
        width: 100%;
        position: relative;
    }

    .champion {
        display: inline-block;
        height: 100%;
        right: 0;
        position: absolute;
    }

    .champion {
        transform: translateX(50%);
    }

    /* New scores (onScoresChange()): a player keeps their element, keyed by player, so a new
       place only changes `right`, which slides. The pop and the fade act on the picture: the
       element's own transform places it astride the marquee's end. */
    .animated .champion {
        transition: right 0.6s ease-in-out;
    }

    .champion-enter-active img {
        animation: champion-pop 0.6s ease-out both;
    }

    .champion-leave-active {
        transition: opacity 0.4s;
    }

    .champion-leave-to {
        opacity: 0;
    }

    @keyframes champion-pop {
        0% {
            transform: scale(0);
        }
        70% {
            transform: scale(1.2);
        }
        100% {
            transform: scale(1);
        }
    }

    /* The selected marquee's spring (armSpring()): three circles on an elastic held on its left.
       It is pulled to the right, the circles moving apart, each one as far again as the one on its
       left (--reach, set on the element); then let go, they all snap back at once and bounce a
       little. On the pictures, not the elements, which keep their own transform (astride the end). */
    .spring .champion img {
        animation: champion-spring 1.1s both;
    }

    @keyframes champion-spring {
        0% {
            transform: translateX(0);
            animation-timing-function: cubic-bezier(0.2, 0.6, 0.4, 1);
        }
        25% {
            transform: translateX(var(--reach));
            animation-timing-function: cubic-bezier(0.6, 0, 1, 1);
        }
        42% {
            transform: translateX(calc(var(--reach) * -0.14));
            animation-timing-function: ease-in-out;
        }
        58% {
            transform: translateX(calc(var(--reach) * 0.06));
            animation-timing-function: ease-in-out;
        }
        75% {
            transform: translateX(calc(var(--reach) * -0.02));
            animation-timing-function: ease-in-out;
        }
        100% {
            transform: translateX(0);
        }
    }

    .champion:nth-child(1) {
        z-index: 1;
    }

    .champion:nth-child(2) {
        z-index: 2;
    }

    .champion:nth-child(3) {
        z-index: 3;
    }

    img {
        height: 100%;
    }

    .champion img {
        aspect-ratio: 1 / 1;
        object-fit: cover;
        border-radius: 50%;
        /* Inside the circle: the avatars keep their size and their place. As thick as the
           marquee is tall (about 3px on the selected one), thinner on the small ones. */
        box-sizing: border-box;
        border: max(1px, 1.2cqh) solid transparent;
        /* Each player's own color (AvatarColor.ts), seen through the transparent parts of the
           picture; set on the element. */
        background-clip: padding-box;
    }

    /* Gold, silver, bronze: tells the overlapping avatars apart. */
    .place-1 img {
        border-color: #ffd23f;
    }

    .place-2 img {
        border-color: #c9d1d9;
    }

    .place-3 img {
        border-color: #cd7f32;
    }

    /* No score yet: the cup, as tall as the marquee and placed like a single avatar, its centre
       on the marquee's end (right 10%, see edgeOffset). In hiscores.svg the handles rise 3.8%
       above the bowl's flat top and the foot is the picture's bottom: a little taller than the
       marquee and raised by its handles' height, the bowl's top is level with the marquee's top
       and the foot with its bottom, both a hair past them, so that the marquee's end is hidden
       (it showed between the handles, then under the foot). */
    .default {
        position: absolute;
        top: 0;
        right: 10%;
        height: 104.5%;
        transform: translate(50%, -4%);
        transform-origin: 50% 100%;
    }

    /* The cup's own spring (armSpring()): it rocks on its foot, left and right, then settles. */
    .spring .default {
        animation: cup-spring 1.1s cubic-bezier(0.3, 0, 0.3, 1) both;
    }

    @keyframes cup-spring {
        0% {
            transform: translate(50%, -4%) rotate(0);
        }
        20% {
            transform: translate(50%, -4%) rotate(-18deg);
        }
        40% {
            transform: translate(50%, -4%) rotate(13deg);
        }
        58% {
            transform: translate(50%, -4%) rotate(-8deg);
        }
        74% {
            transform: translate(50%, -4%) rotate(4deg);
        }
        88% {
            transform: translate(50%, -4%) rotate(-1.5deg);
        }
        100% {
            transform: translate(50%, -4%) rotate(0);
        }
    }
</style>
