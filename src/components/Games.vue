<template>
    <div class="gamesContainer">
        <div class="selectedGameBackground"></div>
        <div class="games">
            <ul ref="gameList">
                <li v-if="windowStart > 0" aria-hidden="true" :style="{height: (windowStart * 10) + '%'}"></li>
                <li v-for="{game, index} in visibleGames" :key="game.id_game" :class="{selected: selectedGameIndex === index}">
                    <div class="marquee"
                         :style="{
                             marginLeft: Math.max(9 - Math.abs(selectedGameIndex - index), 0) + '%',
                         }"
                    >
                        <div class="marqueeArt">
                            <img class="marqueeImg" :src="getMarquee(game.romName)" loading="lazy" decoding="async" alt="">
                            <div v-if="hasFlyerLogoFallback(game.romName)" class="flyerLogoFallback">
                                <img class="flyerBackground" :src="getFlyer(game.romName)" loading="lazy" decoding="async" alt="">
                                <img class="logoOverlay" :src="getLogo(game.romName)" loading="lazy" decoding="async" alt="">
                            </div>
                        </div>
                        <Champions v-if='game.hi' :game='game'></Champions>
                    </div>
                </li>
            </ul>
        </div>
    </div>
</template>

<script setup lang="ts">
import {ref, computed, watch, useTemplateRef} from 'vue';
import Champions from '@/components/Champions.vue';
import Game from '@/model/Game.model';
import {join} from 'path';
import {pathToFileURL} from 'url';
import {getMameService, getGameService} from '@/services';
import defaultMarqueeUrl from '@/assets/default_marquee.jpg';

const props = withDefaults(defineProps<{
    games: Game[];
    selectedGameIndex?: number;
    focused?: boolean;
}>(), {selectedGameIndex: 0, focused: true});

const gameListRef = useTemplateRef<HTMLUListElement>('gameList');

// Only the selected game and its immediate neighbours are ever visible (navigation moves the
// selection by one at a time), so render a window around it instead of the full list - avoids
// keeping hundreds/thousands of rows (each with costly CSS filters) alive in the DOM.
const WINDOW_RADIUS = 20;

const windowStart = computed(() => Math.max(0, props.selectedGameIndex - WINDOW_RADIUS));
const windowEnd = computed(() => Math.min(props.games.length - 1, props.selectedGameIndex + WINDOW_RADIUS));
const visibleGames = computed(() => props.games
    .slice(windowStart.value, windowEnd.value + 1)
    .map((game, i) => ({game, index: windowStart.value + i})));

const mameService = getMameService();
const gameService = getGameService();

const marqueesPath = ref(mameService.marqueePath);
const marquees = ref<string[]>(gameService.loadMarquees());
const flyersPath = ref(mameService.flyerPath);
const flyers = ref<string[]>(gameService.loadFlyers());
const logosPath = ref(mameService.logoPath);
const logos = ref<string[]>(gameService.loadLogos());

watch(() => props.selectedGameIndex, (val) => {
    if (gameListRef.value) {
        gameListRef.value.style.top = (-10 * val) + '%';
    }
});

function findMediaPath(dirPath: string, filenames: string[], romName: string): string | null {
    const i = filenames.indexOf(romName + '.png');
    return i < 0 ? null : join(dirPath, filenames[i]);
}

function toFileUrl(path: string): string {
    // pathToFileURL(), not format({pathname, protocol: 'file', ...}): format() leaves Windows
    // backslashes as-is instead of converting them to the forward slashes a file: URL needs,
    // which broke image loading on Windows (flyers/marquees/logos never displayed).
    return pathToFileURL(path).href;
}

function getMarquee(romName: string) {
    const path = findMediaPath(marqueesPath.value, marquees.value, romName);
    return path ? toFileUrl(path) : defaultMarqueeUrl;
}

function getFlyer(romName: string) {
    const path = findMediaPath(flyersPath.value, flyers.value, romName);
    return path ? toFileUrl(path) : '';
}

function getLogo(romName: string) {
    const path = findMediaPath(logosPath.value, logos.value, romName);
    return path ? toFileUrl(path) : '';
}

/**
 * When a game has no marquee, show its (blurred) flyer with the logo overlaid on top instead -
 * only when both are actually available, otherwise fall back to the default marquee image.
 */
function hasFlyerLogoFallback(romName: string): boolean {
    return !findMediaPath(marqueesPath.value, marquees.value, romName)
        && !!findMediaPath(flyersPath.value, flyers.value, romName)
        && !!findMediaPath(logosPath.value, logos.value, romName);
}
</script>

<style scoped>
    .gamesContainer {
        width: 100%;
        height: 100%;
        overflow: hidden;
        position: relative;
    }

    .selectedGameBackground {
        position: absolute;
        left: 0;
        top: 35%;
        background: linear-gradient(to right, rgba(0, 30, 255, 0.25) 50%, transparent);
        height: 30%;
        width: 50%;
    }

    .games {
        position: relative;
        top: 35%;
        height: 65%;
        width: 50%;
    }

    .games ul {
        position: absolute;
        top: 0;
        right: 0;
        left: 0;
        width: 100%;
        height: 100%;
        overflow: visible;
        transition: top 0.3s ease
    }

    .games ul li {
        display: flex;
        height: 10%;
        width: 100%;
        position: relative;
        align-items: center;
    }

    .games ul li.selected {
        height: 46%;
        top: 0;
    }

    .games .marquee {
        /*margin-left: 10%;*/
        display: inline-block;
        width: 35%;
        height: 90%;
        border-radius: 5px;
        margin-left: -100%;
        position: relative;
        transition: height 0.3s ease, width 0.3s ease, margin-left 0.3s ease, box-shadow 0.3s ease
    }

    /*
     * box-shadow/filter below are scoped to the selected row only: on a weak GPU (e.g. Raspberry
     * Pi), applying blur/saturate to every row - not just the one that's visible full-size -
     * forces the compositor to recompute them for the whole list on every frame.
     */
    .games ul li.selected .marquee {
        width: 100%;
        height: 80%;
        box-shadow: 0 0 30px #000000;
    }

    .marqueeArt {
        position: absolute;
        inset: 0;
        overflow: hidden;
        border-radius: 5px;
    }

    .marqueeArt .marqueeImg {
        position: absolute;
        inset: 0;
        width: 100%;
        height: 100%;
        object-fit: cover;
    }

    .games ul li.selected .marqueeArt {
        filter: saturate(2);
    }

    .flyerLogoFallback {
        position: absolute;
        inset: 0;
        overflow: hidden;
        border-radius: 5px;
    }

    .flyerLogoFallback .flyerBackground {
        position: absolute;
        /* Overscan past the edges so the blur doesn't reveal them under overflow: hidden. */
        inset: -10px;
        width: calc(100% + 20px);
        height: calc(100% + 20px);
        object-fit: cover;
    }

    .games ul li.selected .flyerLogoFallback .flyerBackground {
        filter: blur(8px) brightness(0.6);
    }

    .flyerLogoFallback .logoOverlay {
        position: absolute;
        inset: 10%;
        width: 80%;
        height: 80%;
        object-fit: contain;
        filter: drop-shadow(0 0 10px rgba(0, 0, 0, 0.8));
    }

    .champions {
        position: absolute;
        right: -10%;
        height: 100%;
        width: 100%;
        /*transition: all 0.3s;*/
    }
</style>
