<template>
    <modal>
        <div class="who-played">
            <p>Who made this score?</p>
            <p class="score">{{score}}</p>
            <p class="progress" v-if="total > 1">Score {{index + 1}} / {{total}}</p>
            <div class="letters">
                <i class="fas fa-caret-up"></i>
                <div class="selected" :class="{nobody: !choice}">{{choice ? choice.pseudo3 : '- - -'}}</div>
                <i class="fas fa-caret-down"></i>
            </div>
            <p class="position">{{choice ? `Player ${selected + 1} / ${players.length}` : 'Nobody of this cabinet'}}</p>
            <div class="validate">
                Press
                <span class="arcadeButton"></span>
                to validate
            </div>
            <div class="cancel">
                Press
                <span class="arcadeButton rectangle"></span>
                {{total > 1 ? 'to stop asking' : 'to cancel'}}
            </div>
        </div>
    </modal>
</template>

<script setup lang="ts">
import {ref, computed, onMounted, onUnmounted} from 'vue';
import {useControllable} from '@/composables/useControllable';
import {MAUI_KEYS} from '@/class/MauiControls';
import Modal from '@/components/Modal.vue';

// A score the game wrote without a name (ScoreDeclaration.ts): who made it is picked as the
// letters of a new player are (userRegistration.vue), one name shown at a time and the joystick
// going through them, so that a cabinet with dozens of players asks it the same way. After the
// last player comes "nobody". Shown once per score, best first (Home.vue).

// Nobody may be standing at the cabinet anymore: left alone, the question goes away by itself.
const AUTO_EXPIRE_MS = 20000;
// The key that quit the game, or answered the question before, may still be going down.
const INPUT_GUARD_MS = 600;

const props = defineProps<{
    score: number,
    // Which of the game's nameless scores this one is, from 0, and how many there are.
    index: number,
    total: number,
    players: {remoteId: string, pseudo3: string}[],
}>();
// `skip`: nobody claims this score. `expire`: the scores left are not asked (cancelled, or nobody
// answered).
const emit = defineEmits<{choose: [playerId: string], skip: [], expire: []}>();

// An index in `players`, or players.length for "nobody".
const selected = ref(0);
const choice = computed(() => props.players[selected.value] ?? null);

let autoExpire: number | undefined;
let shownAt = 0;
function restartAutoExpire() {
    clearTimeout(autoExpire);
    autoExpire = window.setTimeout(() => emit('expire'), AUTO_EXPIRE_MS);
}
onMounted(() => {
    shownAt = Date.now();
    restartAutoExpire();
});
onUnmounted(() => clearTimeout(autoExpire));

function move(delta: number) {
    const size = props.players.length + 1;
    selected.value = (selected.value + delta + size) % size;
}

const {onKeydown, onKeyup} = useControllable();

onKeydown((e, isGamepad) => {
    if (Date.now() - shownAt < INPUT_GUARD_MS) {
        return;
    }
    // Someone is answering: going through a long list must not run out of time.
    restartAutoExpire();
    const key = isGamepad ? (e as CustomEvent).detail.key : (e as KeyboardEvent).code;
    switch (key) {
    case MAUI_KEYS.up:
        move(-1);
        break;
    case MAUI_KEYS.down:
        move(1);
        break;
    case MAUI_KEYS.enter:
        if (choice.value) {
            emit('choose', choice.value.remoteId);
        } else {
            emit('skip');
        }
        break;
    case MAUI_KEYS.space:
        emit('expire');
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
        margin: 20px 0 5px;
        font-family: 'Arcade_I', sans-serif;
        font-size: 32px;
        line-height: 40px;
        color: #fff513;
    }
    .progress, .position {
        color: #999;
    }
    /* The look, and the class names, of the new player's letters (userRegistration.vue): Lite
       mode's solid shadow (App.vue) goes by them. */
    .letters {
        margin: 15px auto 5px;
        color: #fff513;
        filter: saturate(1.3);
    }
    .letters i {
        display: block;
        font-size: 24px;
        opacity: 0.7;
    }
    .letters > div.selected {
        font-size: 60px;
        line-height: 70px;
        letter-spacing: 0.2em;
        /* letter-spacing also follows the last letter: taken back to keep the name centered. */
        margin-right: -0.2em;
        text-shadow: 0 0 30px rgba(237, 106, 10, 0.8),
        0 3px 0 rgb(255, 81, 0),
        0 5px 20px rgba(255, 81, 0, 0.5),
        0 6px 5px rgba(242, 0, 10, 0.7),
        0 12px 16px rgba(0, 0, 0, 1),
        6px 12px 9px rgba(0, 0, 0, 1);
    }
    .letters > div.nobody {
        opacity: 0.6;
    }
    .position {
        margin-bottom: 20px;
    }
    .validate, .cancel {
        display: flex;
        align-items: center;
        justify-content: center;
        margin-bottom: 20px;
        font-size: 1.5em;
    }
    .cancel {
        font-size: 1em;
    }
    .arcadeButton {
        display: inline-block;
        width: 30px;
        height: 30px;
        border-radius: 50%;
        box-shadow: #a7a700 1px 1px;
        margin: 0 15px;
        background-color: snow;
    }
    .arcadeButton.rectangle {
        border-radius: 0;
        width: 50px;
    }
</style>
