<template>
    <modal>
        <div class="vote">
            <p>Did you like this game?</p>
            <div class="choices">
                <div class="choice down" :class="{selected: selected === 0}">
                    <svg viewBox="0 0 24 24" aria-hidden="true" class="flipped"><path :d="THUMB_PATH"/></svg>
                </div>
                <div class="choice neutral" :class="{selected: selected === 1}">
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                        <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" stroke-width="2"/>
                        <circle cx="8.5" cy="9.5" r="1.4"/>
                        <circle cx="15.5" cy="9.5" r="1.4"/>
                        <path d="M8 15.5h8" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
                    </svg>
                </div>
                <div class="choice up" :class="{selected: selected === 2}">
                    <svg viewBox="0 0 24 24" aria-hidden="true"><path :d="THUMB_PATH"/></svg>
                </div>
            </div>
            <div class="hint">
                <span class="arcadeButton"></span>
                to vote
                <span class="arcadeButton rectangle"></span>
                to decide later
            </div>
        </div>
    </modal>
</template>

<script setup lang="ts">
import {ref, onMounted, onUnmounted} from 'vue';
import {useControllable} from '@/composables/useControllable';
import {MAUI_KEYS} from '@/class/MauiControls';
import {Vote, VOTE_DOWN, VOTE_NEUTRAL, VOTE_UP} from '@/class/GameVote';
import Modal from '@/components/Modal.vue';

// Nobody may be standing at the cabinet anymore: the prompt goes away by itself, like a skip.
const AUTO_SKIP_MS = 20000;

// Material "thumb_up" icon (the down one is the same path flipped).
const THUMB_PATH = 'M1 21h4V9H1v12zm22-11c0-1.1-.9-2-2-2h-6.31l.95-4.57.03-.32c0-.41-.17-.79-.44-1.06L14.17 1 '
    + '7.59 7.59C7.22 7.95 7 8.45 7 9v10c0 1.1.9 2 2 2h9c.83 0 1.54-.5 1.84-1.22l3.02-7.05c.09-.23.14-.47.14-.73v-2z';

const CHOICES: Vote[] = [VOTE_DOWN, VOTE_NEUTRAL, VOTE_UP];

const emit = defineEmits<{vote: [vote: Vote], skip: []}>();

// Neutral first: an accidental double press on the confirm key never removes a game.
const selected = ref(CHOICES.indexOf(VOTE_NEUTRAL));

let autoSkip: number | undefined;
onMounted(() => {
    autoSkip = window.setTimeout(() => emit('skip'), AUTO_SKIP_MS);
});
onUnmounted(() => clearTimeout(autoSkip));

const {onKeydown, onKeyup} = useControllable();

onKeydown((e, isGamepad) => {
    const key = isGamepad ? (e as CustomEvent).detail.key : (e as KeyboardEvent).code;
    switch (key) {
    case MAUI_KEYS.left:
        selected.value = Math.max(0, selected.value - 1);
        break;
    case MAUI_KEYS.right:
        selected.value = Math.min(CHOICES.length - 1, selected.value + 1);
        break;
    case MAUI_KEYS.enter:
        emit('vote', CHOICES[selected.value]);
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
    .vote {
        font-size: 14px;
        text-align: center;
        line-height: 20px;
    }
    .choices {
        display: flex;
        justify-content: center;
        gap: 40px;
        margin: 30px 0;
    }
    .choice {
        width: 90px;
        height: 90px;
        padding: 15px;
        border-radius: 50%;
        color: #777;
        fill: currentColor;
        opacity: 0.6;
        transition: transform .15s ease, opacity .15s ease, color .15s ease;
    }
    .choice svg {
        width: 100%;
        height: 100%;
    }
    .choice svg.flipped {
        transform: scaleY(-1);
    }
    .choice.selected {
        transform: scale(1.25);
        opacity: 1;
        color: #fff513;
        filter: drop-shadow(0 0 12px rgba(237, 106, 10, 0.9));
    }
    .choice.up.selected {
        color: #4cd964;
    }
    .choice.down.selected {
        color: #ff5b4d;
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
