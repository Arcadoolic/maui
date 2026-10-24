<template>
    <div class="update-screen" :class="{failed: screen.failed}">
        <div class="crt">
            <p class="title">UPDATING MAUI</p>
            <p class="version">TO {{version}}</p>

            <div class="bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" :aria-valuenow="screen.percent ?? undefined">
                <span v-for="cell in CELLS" :key="cell" class="cell" :class="{on: cell <= filled}"></span>
            </div>

            <p class="status">
                <span class="label">{{screen.label}}</span>
                <span class="percent" v-if="screen.percent !== null">{{percentText}}</span>
                <span class="cursor" v-if="!screen.failed">_</span>
            </p>
            <p class="detail">{{screen.detail}}</p>

            <p class="warning" v-if="!screen.failed">DO NOT SWITCH OFF THE CABINET</p>
            <p class="press" v-else>PRESS ANY BUTTON</p>
        </div>
    </div>
</template>

<script setup lang="ts">
import {computed, watch} from 'vue';
import {useControllable} from '@/composables/useControllable';
import {describeUpdateStep, filledCells} from '@/class/UpdateScreen';
import type {UpdateStep} from '@/class/FrontUpdateBridge';

// The front's installation of a version (Home.vue, FrontUpdate.ts), shown like an arcade board
// flashing its ROMs: a block bar, the step in capitals and a blinking cursor. Every key is taken
// while it runs; once it failed, any key gives the cabinet back.

const props = defineProps<{version: string; step: UpdateStep}>();
const emit = defineEmits<{close: []}>();

const CELLS = 20;
// After a failure, keys held from the "yes" must not close the screen before it is read.
const CLOSE_AFTER_MS = 1500;

const screen = computed(() => describeUpdateStep(props.step));
const filled = computed(() => filledCells(screen.value.percent, CELLS));
const percentText = computed(() => `${String(screen.value.percent).padStart(3, '0')}%`);

let failedAt: number | null = null;
watch(() => screen.value.failed, (failed) => {
    failedAt = failed ? Date.now() : null;
}, {immediate: true});

const {onKeydown, onKeyup} = useControllable();

onKeydown(() => {
    if (failedAt !== null && Date.now() - failedAt >= CLOSE_AFTER_MS) {
        emit('close');
    }
});

onKeyup(() => {
    // No-op: keyup is handled by the keydown listener above.
});
</script>

<style scoped>
    .update-screen {
        position: absolute;
        inset: 0;
        z-index: 20;
        display: flex;
        align-items: center;
        justify-content: center;
        background: #000;
        color: snow;
        font-family: 'Arcade_N', sans-serif;
        text-align: center;
    }
    /* Scanlines and a dark edge, drawn once: nothing here moves but the cursor. */
    .update-screen::after {
        content: '';
        position: absolute;
        inset: 0;
        pointer-events: none;
        background:
            repeating-linear-gradient(to bottom, rgba(0, 0, 0, 0) 0, rgba(0, 0, 0, 0) 2px, rgba(0, 0, 0, 0.35) 3px, rgba(0, 0, 0, 0) 4px),
            radial-gradient(ellipse at center, rgba(0, 0, 0, 0) 60%, rgba(0, 0, 0, 0.7) 100%);
    }
    .crt {
        width: 720px;
        max-width: 90vw;
    }
    .title {
        font-size: 32px;
        line-height: 44px;
        color: #fff513;
        text-shadow: 4px 4px 0 #ed6a0a;
        margin: 0;
    }
    .version {
        font-size: 16px;
        color: #4dc3ff;
        margin: 12px 0 48px;
    }
    .bar {
        display: flex;
        gap: 6px;
        padding: 8px;
        border: 4px solid snow;
        box-shadow: 4px 4px 0 #555;
    }
    .cell {
        flex: 1;
        height: 32px;
        background: #1a1a1a;
    }
    .cell.on {
        background: #4cd964;
        box-shadow: inset 0 -6px 0 #2e9e45, inset 0 6px 0 #8af59c;
    }
    .status {
        display: flex;
        justify-content: center;
        gap: 24px;
        font-size: 20px;
        margin: 36px 0 12px;
    }
    .percent {
        color: #fff513;
    }
    .cursor {
        animation: blink 1s steps(1) infinite;
    }
    .detail {
        font-family: 'Arcade_R', sans-serif;
        font-size: 12px;
        color: #aaa;
        min-height: 16px;
    }
    .warning {
        margin-top: 56px;
        font-size: 12px;
        color: #ff5b4d;
    }
    .press {
        margin-top: 56px;
        font-size: 14px;
        animation: blink 1s steps(1) infinite;
    }
    .failed .title {
        color: #ff5b4d;
        text-shadow: 4px 4px 0 #7a1d16;
    }
    .failed .label {
        color: #ff5b4d;
    }
    @keyframes blink {
        50% {
            opacity: 0;
        }
    }
</style>

<style>
    /* Lite mode (UiMode.ts): no endless animation, the cursor and the prompt stand still. */
    html.lite .update-screen .cursor, html.lite .update-screen .press {
        animation: none;
    }
</style>
