<template>
    <div class="champions">
        <TransitionGroup tag="div" name="champion" class="championsContainer" :class="{animated}" :css="animated" v-if="champions.length">
            <div v-for="(champion, index) of champions" :key="champion.player" class="champion" :class="'place-' + (champions.length - index)" :style="{right: (index * 10 + edgeOffset) + '%'}">
                <img v-if="champion.avatar" :src="champion.avatar" alt="" :style="{backgroundColor: avatarColor(champion.pseudo3)}">
                <img v-else src="../assets/defaultPlayer.png" alt="" :style="{backgroundColor: avatarColor(champion.pseudo3)}">
            </div>
        </TransitionGroup>
        <img v-else class="default" src="../assets/hiscores.svg" alt="">
    </div>
</template>

<script setup lang="ts">
import {ref, computed, watch, onMounted, onUnmounted} from 'vue';
import Game from '@/model/Game.model';
import {emitter} from '@/emitter';
import {loadChampions, onLeaderboardsChanged, type BoardRow} from '@/class/LeaderboardSource';
import {avatarColor} from '@/class/AvatarColor';

const props = defineProps<{game: Game}>();

// The best 3 players (LeaderboardSource.ts), drawn from the 3rd to the 1st.
const champions = ref<BoardRow[]>([]);
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

async function onGameChange() {
    loading.value = true;
    champions.value = (await loadChampions(props.game)).reverse();
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

onMounted(async () => {
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
});
</script>

<style scoped>
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
    }
</style>
