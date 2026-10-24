<template>
    <modal>
        <div class="update-offer" :class="{mouse}" data-mouse-nav>
            <p>Update MAUI to version</p>
            <p class="version">{{version}}?</p>
            <p class="detail">MAUI restarts by itself once it is downloaded.</p>
            <div class="choices">
                <div class="choice no" :class="{selected: selected === 0}" @mouseenter="hover(0)" @click="pick(0)">
                    <svg viewBox="0 0 24 24" aria-hidden="true" class="flipped"><path :d="THUMB_PATH"/></svg>
                    <span>No</span>
                </div>
                <div class="choice yes" :class="{selected: selected === 1}" @mouseenter="hover(1)" @click="pick(1)">
                    <svg viewBox="0 0 24 24" aria-hidden="true"><path :d="THUMB_PATH"/></svg>
                    <span>Yes</span>
                </div>
            </div>
            <div class="hint">
                <control-icon action="confirm"></control-icon>
                to choose
            </div>
        </div>
    </modal>
</template>

<script setup lang="ts">
import {ref, onMounted, onUnmounted} from 'vue';
import {useControllable} from '@/composables/useControllable';
import {MAUI_KEYS} from '@/class/MauiControls';
import {controlKey} from '@/class/MauiControlsRuntime';
import Modal from '@/components/Modal.vue';
import ControlIcon from '@/components/ControlIcon.vue';
import {getConfiguration} from '@/services';

// Asked when the cabinet wakes up from idle (Home.vue, FrontUpdate.ts): yes installs the version
// and restarts MAUI on it, no keeps this one. Laid out like the vote (VoteModal.vue).

defineProps<{version: string}>();
const emit = defineEmits<{answer: [install: boolean]}>();

// Whoever woke the cabinet may have walked away: no answer is a no, like the vote's skip.
const AUTO_NO_MS = 20000;

// Material "thumb_up" icon (the "no" one is the same path flipped), as in VoteModal.vue.
const THUMB_PATH = 'M1 21h4V9H1v12zm22-11c0-1.1-.9-2-2-2h-6.31l.95-4.57.03-.32c0-.41-.17-.79-.44-1.06L14.17 1 '
    + '7.59 7.59C7.22 7.95 7 8.45 7 9v10c0 1.1.9 2 2 2h9c.83 0 1.54-.5 1.84-1.22l3.02-7.05c.09-.23.14-.47.14-.73v-2z';

const ANSWERS = [false, true];

// "No" first: the key that woke the cabinet, pressed twice, never starts an update.
const selected = ref(0);

// Windowed mode, like the vote: pointing at a choice selects it, a click answers it.
const mouse = !getConfiguration().fullscreen;

function hover(index: number) {
    if (mouse) {
        selected.value = index;
    }
}

function pick(index: number) {
    if (mouse) {
        emit('answer', ANSWERS[index]);
    }
}

let autoNo: number | undefined;
onMounted(() => {
    autoNo = window.setTimeout(() => emit('answer', false), AUTO_NO_MS);
});
onUnmounted(() => clearTimeout(autoNo));

const {onKeydown, onKeyup} = useControllable();

onKeydown((e, isGamepad) => {
    const key = controlKey(e, isGamepad);
    switch (key) {
    case MAUI_KEYS.left:
        selected.value = 0;
        break;
    case MAUI_KEYS.right:
        selected.value = 1;
        break;
    case MAUI_KEYS.enter:
        emit('answer', ANSWERS[selected.value]);
        break;
    case MAUI_KEYS.space:
        emit('answer', false);
        break;
    }
});

onKeyup(() => {
    // No-op: keyup is handled by the keydown listener above.
});
</script>

<style scoped>
    .update-offer {
        font-size: 14px;
        text-align: center;
        line-height: 20px;
    }
    .version {
        font-size: 22px;
        line-height: 30px;
        color: #fff513;
    }
    .detail {
        color: #aaa;
        font-size: 11px;
    }
    .choices {
        display: flex;
        justify-content: center;
        gap: 80px;
        margin: 30px 0;
    }
    .choice {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 12px;
        width: 90px;
        color: #777;
        fill: currentColor;
        opacity: 0.6;
        transition: transform .15s ease, opacity .15s ease, color .15s ease;
    }
    .choice svg {
        width: 90px;
        height: 90px;
        padding: 15px;
    }
    .choice svg.flipped {
        transform: scaleY(-1);
    }
    .choice.selected {
        transform: scale(1.25);
        opacity: 1;
        filter: drop-shadow(0 0 12px rgba(237, 106, 10, 0.9));
    }
    .choice.yes.selected {
        color: #4cd964;
    }
    .choice.no.selected {
        color: #ff5b4d;
    }
    /* Windowed mode: the choices take the mouse instead of moving the window (App.vue's drag). */
    .update-offer.mouse .choice {
        -webkit-app-region: no-drag;
        cursor: pointer;
    }
    .hint {
        display: flex;
        align-items: center;
        justify-content: center;
    }
</style>
