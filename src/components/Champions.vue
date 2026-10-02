<template>
    <div class="champions">
        <div class="championsContainer" v-if="champions.length">
            <div v-for="(champion, index) of champions" :key="champion.key" class="champion" :style="{right: (index * 10) + '%'}">
                <img v-if="champion.avatar" :src="champion.avatar" alt="">
                <img v-else src="../assets/defaultPlayer.png" alt="">
            </div>
        </div>
        <img v-else class="default" src="../assets/hiscores.svg" alt="">
    </div>
</template>

<script setup lang="ts">
import {ref, watch, onMounted, onUnmounted} from 'vue';
import Game from '@/model/Game.model';
import {emitter} from '@/emitter';
import {loadChampions, onLeaderboardsChanged, type BoardRow} from '@/class/LeaderboardSource';

const props = defineProps<{game: Game}>();

// The best 3 players (LeaderboardSource.ts), drawn from the 3rd to the 1st.
const champions = ref<BoardRow[]>([]);
const loading = ref(true);
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
    }

    .default {
        position: absolute;
        right: 0;
    }
</style>
