<template>
    <div class="hiscores">
        <!-- The rows go down, then the next mode's come back up. -->
        <Transition name="mode-swap" mode="out-in" :css="swapping">
            <div class="board" :key="shownMode?.id ?? 'default'">
                <p class="mode" v-if="shownMode">{{shownMode.label}}</p>
                <p v-if="loading">Loading hiscores...</p>
                <p v-else-if="!scores.length" class="no-hiscores">No Hiscores Yet !</p>
                <template v-else>
                    <div class="hiscore" :class="{first: index === 0, fresh: fresh?.includes(score.key)}" v-for="(score, index) of scores" :key="score.key">
                        <div class="icon">
                            <img :src="score.avatar" v-if="score.avatar" alt="">
                            <img v-else src="../assets/defaultPlayer.png" alt="">
                        </div>
                        <div class="info">
                            <span class="place">{{index + 1}}</span>
                            <div class="score_name">
                                <p class="name">{{score.pseudo3}}</p>
                                <p class="score">{{score.score}}</p>
                            </div>
                        </div>
                    </div>
                </template>
            </div>
        </Transition>
    </div>
</template>

<script setup lang="ts">
import {ref, watch, onMounted, onUnmounted} from 'vue';
import Game from '@/model/Game.model';
import {emitter} from '@/emitter';
import {loadHiscores, onLeaderboardsChanged, type BoardRow} from '@/class/LeaderboardSource';
import {useModeTable} from '@/class/ModeRotation';
import type {ModeTable} from '@/class/ModeTables';

// `fresh`: the rows a game just played added (Home.vue's score reveal), drawn arriving.
// `freshTable`: the table those rows are in, kept on screen while they are shown.
const props = defineProps<{game: Game; fresh?: string[]; freshTable?: string | null}>();
const mode = useModeTable(() => props.game.romName, () => props.fresh?.length ? props.freshTable ?? null : null);

// 9 rows (LeaderboardSource.ts): the best one is drawn on its own above the box (.first), the rest
// fill the 3-column grid below it. Local scores in LOCAL mode, MAUI-API's in ONLINE mode.
const scores = ref<BoardRow[]>([]);
// The mode of those rows: set with them, so that the swap starts once they are read.
const shownMode = ref<ModeTable | null>(null);
// Only between the modes of a game: another game's board simply replaces this one.
const swapping = ref(false);
const loading = ref(true);
let stopListening: (() => void) | null = null;

async function reload() {
    const game = props.game;
    const next = mode.value;
    const rows = await loadHiscores(game, next?.id);
    // The list or the mode may have moved on while the rows were read.
    if (game === props.game && next?.id === mode.value?.id) {
        scores.value = rows;
        shownMode.value = next;
    }
}

async function onGameChange() {
    swapping.value = false;
    loading.value = true;
    await reload();
    loading.value = false;
}

watch(() => props.game, onGameChange);
// The next mode's rows replace the previous ones without the loading message.
watch(() => mode.value?.id, () => {
    // Not while another game's board is being read.
    swapping.value = !loading.value;
    return reload();
});

onMounted(async () => {
    await onGameChange();

    emitter.on('game-quit', onGameChange);
    stopListening = onLeaderboardsChanged(onGameChange);
});

// See Champions.vue: `emitter` is a module-level mitt singleton and outlives this component, so
// the handler has to be removed explicitly or every mount leaks one.
onUnmounted(() => {
    emitter.off('game-quit', onGameChange);
    stopListening?.();
});
</script>

<style scoped>
    .hiscores {
        position: absolute;
        right: 10%;
        bottom: 0;
        width: 45%;
        height: 35%;
        background-color: rgba(6, 24, 36, 0.9);
        box-shadow: 0 0 65px rgb(0, 0, 0);
        color: #fff513;
        font-family: 'Arcade_I', sans-serif;
        text-shadow: 0 0 30px rgba(237, 106, 10, 0.8),
        0 3px 0 rgb(255, 81, 0),
        0 5px 20px rgba(255, 81, 0, 0.5),
        0 6px 5px rgba(242, 0, 10, 0.7),
        0 8px 5px rgba(0, 0, 0, 1);
    }

    /* The whole box, so that it moves as one and .first keeps its place on the top edge. */
    .board {
        position: absolute;
        inset: 0;
        padding-top: 8vh;
    }

    /* Down out of the screen (the box sits on its bottom edge), then the next one back up: far
       enough for .first, which sticks out above the box. */
    .mode-swap-leave-active {
        transition: transform 0.35s ease-in, opacity 0.35s ease-in;
    }

    .mode-swap-enter-active {
        transition: transform 0.45s cubic-bezier(0.2, 0.8, 0.3, 1.15), opacity 0.3s ease-out;
    }

    .mode-swap-leave-to,
    .mode-swap-enter-from {
        transform: translateY(130%);
        opacity: 0;
    }

    /* The mode shown, for a game ranking several. */
    .mode {
        position: absolute;
        bottom: 1vh;
        left: 0;
        right: 0;
        margin: 0;
        text-align: center;
        font-size: 2vh;
        text-transform: uppercase;
        z-index: 1;
    }

    /* Nobody has a score on this game yet: one message in the middle of the box (absolute, so the
       8vh top padding kept for the first place doesn't push it off-center). */
    .no-hiscores {
        position: absolute;
        top: 0;
        right: 0;
        bottom: 0;
        left: 0;
        margin: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        text-align: center;
        /* The arcade font is wide: at 2.5vw the text took 92% of the box's width, 2.2vw leaves ~10% each side. */
        font-size: 2.2vw;
    }

    .hiscore {
        width: 33%;
        display: table;
        float: left;
    }

    .hiscore > * {
        display: inline-block;
        vertical-align: middle;
    }

    .icon {
        width: 30%;
        padding: 1vh;
    }

    .icon img {
        width: 100%;
        aspect-ratio: 1 / 1;
        object-fit: cover;
        border-radius: 50%;
    }

    .info {
        width: 70%;
    }

    .info > * {
        display: inline-block;
        vertical-align: middle;
    }

    .info .place {
        font-size: 2.5vw;
        letter-spacing: -10px;
    }

    .info .score_name {
        margin-left: 1.2vw;
    }

    .info .score {
        color: #FFF;
        text-shadow: none;
        line-height: 1.2vw;
    }

    .hiscore.first {
        position: absolute;
        top: 0;
        left: 50%;
        transform: translate(-50%, -50%);
        font-size: 2vh;
        white-space: nowrap;
    }

    .hiscore.first .icon {
        width: auto;
    }

    .hiscore.first .icon img {
        width: 6vw;
    }

    .hiscore.first .info {
        width: auto;
    }

    .hiscore.first .info .place {
        font-size: 4vw;
    }

    .hiscore.first .info .score_name {
        font-size: 1.8vw;
        line-height: 2.5vw;
    }

    /* A score the game just played added (Home.vue's score reveal): its avatar pops in, then the
       row blinks three times. On the inner elements: .first is placed with a transform of its own. */
    .hiscore.fresh .icon img {
        animation: score-pop 0.7s ease-out both;
    }

    .hiscore.fresh .info {
        animation: score-blink 0.5s steps(1) 0.7s 6;
    }

    @keyframes score-pop {
        0% {
            transform: scale(0);
        }
        70% {
            transform: scale(1.25);
        }
        100% {
            transform: scale(1);
        }
    }

    @keyframes score-blink {
        50% {
            opacity: 0.15;
        }
    }

</style>
