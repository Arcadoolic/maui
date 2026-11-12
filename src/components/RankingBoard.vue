<template>
    <div class="ranking-container" @click="mouse && emit('close')">
        <div class="ranking">
            <p v-if="state === 'loading'" class="ranking-message">Loading…</p>
            <p v-else-if="state === 'unavailable'" class="ranking-message">The global podium needs ONLINE</p>
            <p v-else-if="!lines.length" class="ranking-message">No hiscores yet !</p>
            <TransitionGroup v-else name="board" tag="ol" class="ranking-rows">
                <li v-for="line of shown" :key="line.playerId" class="ranking-row" :class="'rank-' + line.rank">
                    <span class="rank">{{line.rank}}</span>
                    <img :src="avatars[line.playerId] || defaultPlayer" alt="" :style="{backgroundColor: avatarColor(line.pseudo3)}">
                    <span class="pseudo">{{line.pseudo3}}</span>
                    <span class="points">{{line.points}}<small>pts</small></span>
                    <span class="crowns" :class="{none: !line.crowns}">
                        <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2 12h12l1-8-4 3-3-5-3 5-4-3z"/></svg>{{line.crowns}}
                    </span>
                </li>
            </TransitionGroup>
        </div>
    </div>
</template>

<script setup lang="ts">
import {onMounted, onUnmounted, reactive, ref} from 'vue';
import Log from 'electron-log';
import defaultPlayer from '@/assets/defaultPlayer.png';
import {avatarColor} from '@/class/AvatarColor';
import {createOnlineClient} from '@/class/OnlineClient';
import {getConfiguration} from '@/services';
import type {RankingLine} from '@/class/MauiApiClient';
import {BOARD_PLAYERS, boardTimeline, fetchRankingAvatar, rankingAvatarUrl} from '@/class/RankingBoard';

// The global podium of MAUI-API (RankingBoard.ts), under its title where the game's was (Home.vue,
// which also sends it away at the first key): the first players come in from the right, the next
// ones scroll up, then the board says its cycle ended.
const emit = defineEmits<{close: []}>();

const state = ref<'loading' | 'ready' | 'unavailable'>('loading');
const lines = ref<RankingLine[]>([]);
const shown = ref<RankingLine[]>([]);
const avatars = reactive<Record<string, string>>({});
const timers: number[] = [];
let closed = false;

// Windowed mode, like the list of games: a click closes it.
const mouse = !getConfiguration().fullscreen;

function close() {
    if (!closed) {
        closed = true;
        emit('close');
    }
}

// The title's drop (Home.vue's `title` transition) before the first player.
const INTRO_MS = 400;
const openedAt = Date.now();

function play() {
    // MAUI-API answered while the intro was still on: the players wait for its end.
    const wait = Math.max(0, INTRO_MS - (Date.now() - openedAt));
    for (const step of boardTimeline(lines.value.length)) {
        timers.push(window.setTimeout(() => {
            if (step.kind === 'end') {
                close();
            } else if (step.kind === 'enter') {
                shown.value = [...shown.value, lines.value[step.index]];
            } else {
                // One leaves at the top as the next comes in at the bottom.
                shown.value = [...shown.value.slice(1), lines.value[step.index]];
            }
        }, wait + step.atMs));
    }
}

onMounted(async () => {
    try {
        const client = await createOnlineClient();
        const answer = client ? await client.getRanking(BOARD_PLAYERS) : null;
        if (closed) {
            return;
        }
        if (!client || answer?.kind !== 'ok') {
            state.value = 'unavailable';
        } else {
            lines.value = answer.value;
            state.value = 'ready';
            for (const line of answer.value) {
                const url = rankingAvatarUrl(line);
                if (url) {
                    avatars[line.playerId] = url;
                } else if (line.avatar) {
                    // Shown with the default picture meanwhile.
                    void fetchRankingAvatar(line, playerId => client.getAvatar(playerId))
                        .then((fetched) => {
                            if (fetched) {
                                avatars[line.playerId] = fetched;
                            }
                        })
                        .catch(() => undefined);
                }
            }
        }
    } catch (err) {
        Log.warn('[RankingBoard] Ranking not loaded: ' + (err instanceof Error ? err.message : String(err)));
        state.value = 'unavailable';
    }
    if (!closed) {
        play();
    }
});

onUnmounted(() => {
    closed = true;
    timers.forEach(timer => clearTimeout(timer));
});
</script>

<style scoped>
    /* Where the list of games was, under the podium's title (Home.vue's .podiumTitle). */
    .ranking-container {
        position: absolute;
        inset: 0;
        z-index: 3;
    }
    .ranking {
        position: absolute;
        top: 17vh;
        left: 0;
        right: 0;
        margin: 0 auto;
        width: 62vw;
        overflow: hidden;
        font-family: 'Arcade_I', sans-serif;
        color: #fff513;
        text-shadow: 0 3px 0 rgb(255, 81, 0), 0 6px 5px rgba(242, 0, 10, 0.7), 0 8px 5px rgba(0, 0, 0, 1);
    }
    .ranking-message {
        text-align: center;
        font-size: 2vw;
    }
    .ranking-rows {
        position: relative;
        margin: 0;
        padding: 0;
        list-style: none;
        /* Ten rows, whatever the number shown: the board keeps its size while it scrolls. */
        height: calc(10 * 7.4vh);
    }
    .ranking-row {
        display: flex;
        align-items: center;
        gap: 2vw;
        width: 100%;
        height: 7.4vh;
        padding: 0 2vw;
        box-sizing: border-box;
        font-size: 2.4vw;
        border-bottom: 2px solid rgba(255, 245, 19, 0.15);
    }
    .ranking-row img {
        height: 6vh;
        aspect-ratio: 1 / 1;
        object-fit: cover;
        border-radius: 50%;
    }
    .rank {
        width: 3.5vw;
        text-align: right;
    }
    .pseudo {
        flex: 1;
    }
    .points {
        color: #fff;
        text-shadow: none;
    }
    .points small {
        margin-left: 0.4vw;
        font-size: 0.5em;
    }
    .crowns {
        display: inline-flex;
        align-items: center;
        gap: 0.4vw;
        width: 6vw;
        justify-content: flex-end;
        color: #ffd700;
        text-shadow: none;
    }
    .crowns.none {
        opacity: 0.3;
    }
    .crowns svg {
        width: 1.6vw;
        height: 1.6vw;
        fill: currentColor;
    }
    /* Gold, silver, bronze, as on the marquees' podium (Champions.vue). */
    .rank-1 .rank { color: #ffd700; }
    .rank-2 .rank { color: #c0c0c0; }
    .rank-3 .rank { color: #cd7f32; }

    /* In from the right; out at the top while the others move up. */
    .board-enter-active {
        transition: transform 0.6s ease-out, opacity 0.6s ease-out;
    }
    .board-enter-from {
        transform: translateX(70vw);
        opacity: 0;
    }
    .board-move {
        transition: transform 0.8s ease-in-out;
    }
    .board-leave-active {
        position: absolute;
        transition: transform 0.8s ease-in-out, opacity 0.8s ease-in-out;
    }
    .board-leave-to {
        transform: translateY(-100%);
        opacity: 0;
    }
</style>
