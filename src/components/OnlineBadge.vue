<template>
    <div v-if="display" class="online-badge" :class="[indicator, {'dot-only': dotOnly}]" :title="display.title">{{ dotOnly ? '' : display.label }}</div>
</template>

<script setup lang="ts">
// ONLINE / OFFLINE and a dot in the top right corner, the BO header badge's states and colors
// without the cabinet's name: the only sign of the connection to MAUI-API while the cabinet runs
// fullscreen. The BO can leave only the dot, more discreet (Config.onlineBadgeDotOnly).
import {computed, onMounted, onUnmounted, ref} from 'vue';
import * as remote from '@electron/remote';
import type {OnlineIndicator} from '@/class/OnlineSetup';
import {describeFrontIndicator, ONLINE_INDICATOR_GLOBAL, type OnlineIndicatorReader} from '@/class/OnlineIndicatorBridge';
import {getConfiguration} from '@/services';

const REFRESH_MS = 5000;

// Read once: the BO reloads the front when the setting changes.
const dotOnly = getConfiguration().onlineBadgeDotOnly;
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
        align-items: center;
        gap: 0.4vw;
        font-family: 'Arcade_N', sans-serif;
        font-size: 0.7vw;
        padding: 0.3vw 0.5vw;
        border-radius: 0.3vw;
        background-color: rgba(0, 0, 0, 0.6);
        pointer-events: none;
    }

    .online-badge.dot-only {
        padding: 0;
        background-color: transparent;
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
