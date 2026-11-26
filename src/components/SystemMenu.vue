<template>
    <modal>
        <div class="system-menu" :class="{mouse}" data-mouse-nav>
            <p>Menu</p>
            <ul>
                <li v-for="(entry, index) in entries" :key="entry.id" :class="{selected: selected === index}"
                    @mouseenter="hover(index)" @click="pick(index)">{{entry.label}}</li>
            </ul>
            <div class="hint">
                <control-icon action="confirm"></control-icon>
                to choose
                <span class="back" @click="mouse && emit('close')">
                    <control-icon action="scores"></control-icon>
                    to go back
                </span>
            </div>
        </div>
    </modal>
</template>

<script setup lang="ts">
import {ref, onMounted, onUnmounted} from 'vue';
import {useControllable} from '@/composables/useControllable';
import {MAUI_KEYS} from '@/class/MauiControls';
import {controlKey} from '@/class/MauiControlsRuntime';
import type {SystemMenuEntry, SystemMenuItem} from '@/class/SystemMenuEntries';
import Modal from '@/components/Modal.vue';
import ControlIcon from '@/components/ControlIcon.vue';
import {getConfiguration} from '@/services';

// The Menu action of the list of games (Home.vue): up and down pick an entry, Confirm runs it,
// Scores / back closes. Laid out like the vote (VoteModal.vue).

const props = defineProps<{entries: SystemMenuItem[]}>();
const emit = defineEmits<{choose: [entry: SystemMenuEntry], close: []}>();

// Left alone, the menu goes away by itself.
const AUTO_CLOSE_MS = 20000;

// The first entry (the update check) is harmless: a key pressed twice never quits nor shuts down.
const selected = ref(0);

// Windowed mode, like the vote: pointing at an entry selects it, a click runs it.
const mouse = !getConfiguration().fullscreen;

function hover(index: number) {
    if (mouse) {
        selected.value = index;
    }
}

function pick(index: number) {
    if (mouse) {
        emit('choose', props.entries[index].id);
    }
}

let autoClose: number | undefined;
function restartAutoClose() {
    clearTimeout(autoClose);
    autoClose = window.setTimeout(() => emit('close'), AUTO_CLOSE_MS);
}
onMounted(restartAutoClose);
onUnmounted(() => clearTimeout(autoClose));

const {onKeydown, onKeyup} = useControllable();

onKeydown((e, isGamepad) => {
    restartAutoClose();
    const count = props.entries.length;
    switch (controlKey(e, isGamepad)) {
    case MAUI_KEYS.up:
        selected.value = (selected.value + count - 1) % count;
        break;
    case MAUI_KEYS.down:
        selected.value = (selected.value + 1) % count;
        break;
    case MAUI_KEYS.enter:
        emit('choose', props.entries[selected.value].id);
        break;
    case MAUI_KEYS.space:
        emit('close');
        break;
    }
});

onKeyup(() => {
    // No-op: keyup is handled by the keydown listener above.
});
</script>

<style scoped>
    .system-menu {
        font-size: 14px;
        text-align: center;
        line-height: 20px;
    }
    ul {
        list-style: none;
        margin: 24px 0;
        padding: 0;
    }
    li {
        margin: 10px 0;
        padding: 12px 24px;
        color: #777;
        opacity: 0.7;
        transition: transform .15s ease, opacity .15s ease, color .15s ease;
    }
    li.selected {
        transform: scale(1.1);
        opacity: 1;
        color: #fff513;
        filter: drop-shadow(0 0 12px rgba(237, 106, 10, 0.9));
    }
    /* Windowed mode: the entries take the mouse instead of moving the window (App.vue's drag). */
    .system-menu.mouse li, .system-menu.mouse .back {
        -webkit-app-region: no-drag;
        cursor: pointer;
    }
    .hint {
        display: flex;
        align-items: center;
        justify-content: center;
    }
    .back {
        display: inline-flex;
        align-items: center;
        margin-left: 13px;
    }
</style>
