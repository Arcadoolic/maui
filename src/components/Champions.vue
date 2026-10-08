<template>
    <div class="champions">
        <div class="championsContainer" :class="{astride: astride}" v-if="champions.length">
            <div v-for="(champion, index) of champions" :key="champion.key" class="champion" :class="'place-' + (champions.length - index)" :style="{right: (index * 10 + edgeOffset) + '%'}">
                <img v-if="champion.avatar" :src="champion.avatar" alt="">
                <img v-else src="../assets/defaultPlayer.png" alt="">
            </div>
        </div>
        <img v-else class="default" src="../assets/hiscores.svg" alt="">
    </div>
</template>

<script setup lang="ts">
import {ref, computed, watch, onMounted, onUnmounted} from 'vue';
import Game from '@/model/Game.model';
import {emitter} from '@/emitter';
import {loadChampions, onLeaderboardsChanged, type BoardRow} from '@/class/LeaderboardSource';

const props = defineProps<{game: Game}>();

// The best 3 players (LeaderboardSource.ts), drawn from the 3rd to the 1st.
const champions = ref<BoardRow[]>([]);
const loading = ref(true);
// With fewer than 3 players, the last one is drawn astride the marquee's end, its centre on the
// edge, and the best one a step to its left. The container (Games.vue's .champions) is as wide
// as the marquee and starts 10% further right: that is where the edge is.
const astride = computed(() => champions.value.length < 3);
const edgeOffset = computed(() => astride.value ? 10 : 0);
let stopListening: (() => void) | null = null;

async function onGameChange() {
    loading.value = true;
    champions.value = (await loadChampions(props.game)).reverse();
    loading.value = false;
}

watch(() => props.game, onGameChange);

onMounted(async () => {
    await onGameChange();

    emitter.on('game-quit', onGameChange);
    emitter.on('hiscores-loaded', onGameChange);
    stopListening = onLeaderboardsChanged(onGameChange);
});

// `emitter` is a module-level mitt singleton, so it outlives every component instance that
// subscribes to it. Without this, each mount leaves behind a handler closed over a destroyed
// component's props and refs, and they accumulate for the life of the process. The Vue 2 original
// never called `EventBus.$off` either, but there the bus was a Vue instance torn down with the
// app; here nothing ever removes the handler but this.
onUnmounted(() => {
    emitter.off('game-quit', onGameChange);
    emitter.off('hiscores-loaded', onGameChange);
    stopListening?.();
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

    .astride .champion {
        transform: translateX(50%);
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

    .default {
        position: absolute;
        right: 0;
    }
</style>
