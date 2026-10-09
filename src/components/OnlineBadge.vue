<template>
    <div v-if="display" class="online-badge" :class="indicator" :title="display.title"></div>
</template>

<script setup lang="ts">
// A dot in the top right corner, the BO header badge's states and colors without its text: the
// only sign of the connection to MAUI-API while the cabinet runs fullscreen, kept discreet.
import {computed, onMounted, onUnmounted, ref} from 'vue';
import * as remote from '@electron/remote';
import type {OnlineIndicator} from '@/class/OnlineSetup';
import {describeFrontIndicator, ONLINE_INDICATOR_GLOBAL, type OnlineIndicatorReader} from '@/class/OnlineIndicatorBridge';

const REFRESH_MS = 5000;

const indicator = ref<OnlineIndicator | null>(null);
const display = computed(() => describeFrontIndicator(indicator.value));
let timer: ReturnType<typeof setInterval> | undefined;

function refresh(): void {
    try {
        const read = remote.getGlobal(ONLINE_INDICATOR_GLOBAL) as OnlineIndicatorReader | undefined;
        indicator.value = read ? read() : null;
    } catch {
        indicator.value = null;
    }
}

onMounted(() => {
    refresh();
    timer = setInterval(refresh, REFRESH_MS);
});

onUnmounted(() => clearInterval(timer));
</script>

<style scoped>
    .online-badge {
        position: fixed;
        top: 0.6vw;
        right: 0.8vw;
        z-index: 1000;
        display: flex;
        pointer-events: none;
    }

    .online-badge::before {
        content: '';
        width: 0.6vw;
        height: 0.6vw;
        border-radius: 50%;
        background-color: currentColor;
    }

    .online-badge.online {
        color: #6bff8a;
    }

    .online-badge.online::before {
        box-shadow: 0 0 0.3vw 0.15vw rgba(107, 255, 138, 0.6);
        animation: online-halo 2s ease-in-out infinite;
    }

    /* Last heartbeat failed: amber and blinking until the next one gets through. */
    .online-badge.unstable {
        color: #ffd166;
        animation: online-blink 1s ease-in-out infinite;
    }

    .online-badge.offline {
        color: #ff6b6b;
    }

    /* ONLINE turned off: a hollow grey dot. */
    .online-badge.off {
        color: #aaaaaa;
    }

    .online-badge.off::before {
        background-color: transparent;
        border: 0.1vw solid currentColor;
    }

    @keyframes online-halo {
        50% {
            box-shadow: 0 0 0.6vw 0.3vw rgba(107, 255, 138, 0.25);
        }
    }

    @keyframes online-blink {
        50% {
            opacity: 0.25;
        }
    }
</style>
