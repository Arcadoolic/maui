<template>
    <div class="gamesContainer">
        <div class="selectedGameBackground"></div>
        <div class="games">
            <ul ref="gameList">
                <li v-for="(game, index) in games" :key="game.id_game" :class="{selected: selectedGameIndex === index}">
                    <div class="marquee"
                         :style="{
                             marginLeft: Math.max(9 - Math.abs(selectedGameIndex - index), 0) + '%',
                         }"
                    >
                        <div class="marqueeArt" :style="{backgroundImage: getMarquee(game.romName)}">
                            <div v-if="hasFlyerLogoFallback(game.romName)" class="flyerLogoFallback">
                                <div class="flyerBackground" :style="{backgroundImage: getFlyer(game.romName)}"></div>
                                <img class="logoOverlay" :src="getLogo(game.romName)" alt="">
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
import {ref, watch, useTemplateRef} from 'vue';
import Champions from '@/components/Champions.vue';
import Game from '@/model/Game.model';
import {join} from 'path';
import {format} from 'url';
import {getMameService, getGameService} from '@/services';

const props = withDefaults(defineProps<{
    games: Game[];
    selectedGameIndex?: number;
    focused?: boolean;
}>(), {selectedGameIndex: 0, focused: true});

const gameListRef = useTemplateRef<HTMLUListElement>('gameList');

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
    return format({pathname: path, protocol: 'file', slashes: true});
}

function getMarquee(romName: string) {
    const path = findMediaPath(marqueesPath.value, marquees.value, romName);
    return path ? `url(${toFileUrl(path)})` : '';
}

function getFlyer(romName: string) {
    const path = findMediaPath(flyersPath.value, flyers.value, romName);
    return path ? `url(${toFileUrl(path)})` : '';
}

function getLogo(romName: string) {
    const path = findMediaPath(logosPath.value, logos.value, romName);
    return path ? toFileUrl(path) : '';
}

/**
 * When a game has no marquee, show its (blurred) flyer with the logo overlaid on top instead -
 * only when both are actually available, otherwise fall back to the default marquee background
 * image from CSS.
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
        box-shadow: 0 0 30px #000000;
        margin-left: -100%;
        position: relative;
        transition: height 0.3s ease, width 0.3s ease, margin-left 0.3s ease, margin-left 0.3s ease
    }

    .games ul li.selected .marquee {
        width: 100%;
        height: 80%;
    }

    .marqueeArt {
        position: absolute;
        inset: 0;
        overflow: hidden;
        background-repeat: no-repeat;
        background-image: url(../assets/default_marquee.jpg);
        background-size: cover;
        background-position: center;
        border-radius: 5px;
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
        background-repeat: no-repeat;
        background-size: cover;
        background-position: center;
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
