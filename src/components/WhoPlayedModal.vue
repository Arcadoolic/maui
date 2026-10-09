<template>
    <modal>
        <div class="who-played">
            <p>Who made this score?</p>
            <p class="score">{{score}}</p>
            <div class="players">
                <div class="player" :class="{selected: player.remoteId === players[selected].remoteId}"
                     v-for="player of visiblePlayers" :key="player.remoteId">
                    <img :src="player.avatar" v-if="player.avatar" alt="">
                    <img v-else src="../assets/defaultPlayer.png" alt="">
                    <span>{{player.pseudo3}}</span>
                </div>
            </div>
            <div class="hint">
                <span class="arcadeButton"></span>
                it's me
                <span class="arcadeButton rectangle"></span>
                nobody
            </div>
        </div>
    </modal>
</template>

<script setup lang="ts">
import {ref, computed, onMounted, onUnmounted} from 'vue';
import {useControllable} from '@/composables/useControllable';
import {MAUI_KEYS} from '@/class/MauiControls';
import {playerAvatar} from '@/class/LeaderboardSource';
import Modal from '@/components/Modal.vue';

// A score the game wrote without a name (ScoreDeclaration.ts): the players of the cabinet who
// could have made it, picked with the joystick. Shown once per score, best first (Home.vue).

// Nobody may be standing at the cabinet anymore: the question goes away by itself.
const AUTO_EXPIRE_MS = 20000;
// The key that quit the game, or answered the question before, may still be going down.
const INPUT_GUARD_MS = 600;
// Rows shown at once: a longer list scrolls around the selection.
const VISIBLE_PLAYERS = 5;

const props = defineProps<{score: number, players: {remoteId: string, pseudo3: string}[]}>();
// `skip`: nobody claims this score. `expire`: nobody answered, the scores left are not asked.
const emit = defineEmits<{choose: [playerId: string], skip: [], expire: []}>();

const selected = ref(0);

const visiblePlayers = computed(() => {
    const first = Math.max(0, Math.min(selected.value - Math.floor(VISIBLE_PLAYERS / 2), props.players.length - VISIBLE_PLAYERS));
    return props.players.slice(first, first + VISIBLE_PLAYERS).map(player => ({...player, avatar: playerAvatar(player.pseudo3)}));
});

let autoExpire: number | undefined;
let shownAt = 0;
onMounted(() => {
    shownAt = Date.now();
    autoExpire = window.setTimeout(() => emit('expire'), AUTO_EXPIRE_MS);
});
onUnmounted(() => clearTimeout(autoExpire));

const {onKeydown, onKeyup} = useControllable();

onKeydown((e, isGamepad) => {
    if (Date.now() - shownAt < INPUT_GUARD_MS) {
        return;
    }
    const key = isGamepad ? (e as CustomEvent).detail.key : (e as KeyboardEvent).code;
    switch (key) {
    case MAUI_KEYS.up:
        selected.value = Math.max(0, selected.value - 1);
        break;
    case MAUI_KEYS.down:
        selected.value = Math.min(props.players.length - 1, selected.value + 1);
        break;
    case MAUI_KEYS.enter:
        emit('choose', props.players[selected.value].remoteId);
        break;
    case MAUI_KEYS.space:
        emit('skip');
        break;
    }
});

onKeyup(() => {
    // No-op: keyup is handled by the keydown listener above.
});
</script>

<style scoped>
    .who-played {
        font-size: 14px;
        text-align: center;
        line-height: 20px;
    }
    .score {
        margin: 20px 0;
        font-family: 'Arcade_I', sans-serif;
        font-size: 32px;
        line-height: 40px;
        color: #fff513;
    }
    .players {
        display: inline-flex;
        flex-direction: column;
        gap: 8px;
        margin-bottom: 25px;
    }
    .player {
        display: flex;
        align-items: center;
        gap: 20px;
        width: 260px;
        padding: 6px 16px;
        border: 2px solid transparent;
        border-radius: 8px;
        color: #777;
        opacity: 0.6;
        font-family: 'Arcade_I', sans-serif;
        font-size: 22px;
    }
    .player img {
        width: 44px;
        height: 44px;
        border-radius: 50%;
        object-fit: cover;
    }
    .player.selected {
        opacity: 1;
        color: #fff513;
        border-color: #fff513;
        background: rgba(6, 24, 36, 0.9);
    }
    .hint {
        display: flex;
        align-items: center;
        justify-content: center;
    }
    .arcadeButton {
        display: inline-block;
        width: 30px;
        height: 30px;
        border-radius: 50%;
        box-shadow: #a7a700 1px 1px;
        margin: 0 10px 0 25px;
        background-color: snow;
    }
    .arcadeButton.rectangle {
        border-radius: 0;
        width: 50px;
    }
</style>
