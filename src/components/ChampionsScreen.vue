<template>
    <div class="champions-screen">
        <Transition name="champion">
            <div class="champion" :class="{intro: index === 0 && intro}" :key="index">
                <div class="champion-flyer">
                    <div class="flyer" :class="{landscape: landscape[current.romname]}" v-if="pictures[current.romname + '/flyer']"
                         :style="{backgroundImage: 'url(' + pictures[current.romname + '/flyer'] + ')'}"></div>
                </div>
                <div class="champion-marquee">
                    <img v-if="pictures[current.romname + '/marquee']" :src="pictures[current.romname + '/marquee']" alt="" class="marquee-art">
                    <span v-else-if="pictures[current.romname + '/logo']" class="marquee-logo">
                        <img :src="pictures[current.romname + '/logo']" alt="">
                    </span>
                    <span v-else class="marquee-name">{{gameName}}</span>
                    <span class="place">1ST</span>
                    <span class="avatar" :style="{backgroundColor: avatarColor(current.pseudo3)}">
                        <img :src="avatars[current.playerId] || defaultPlayer" alt="">
                    </span>
                </div>
                <p class="game-name">{{current.description}}</p>
                <div class="champion-band">
                    <div class="who">
                        <span class="pseudo">{{current.pseudo3}}</span>
                        <span class="score">{{current.score.toLocaleString('en-US')}}</span>
                    </div>
                    <dl>
                        <div>
                            <dt>{{current.days ? (current.days === 1 ? 'Day unbeaten' : 'Days unbeaten') : 'First today'}}</dt>
                            <dd>{{current.days || 'NEW'}}</dd>
                        </div>
                        <div>
                            <dt>{{current.players - 1 === 1 ? 'Challenger beaten' : 'Challengers beaten'}}</dt>
                            <dd>{{current.players - 1}}</dd>
                        </div>
                    </dl>
                </div>
            </div>
        </Transition>
    </div>
</template>

<script setup lang="ts">
import {computed, onMounted, onUnmounted, reactive, ref} from 'vue';
import defaultPlayer from '@/assets/defaultPlayer.png';
import {avatarColor} from '@/class/AvatarColor';
import {splitGameTitle} from '@/class/GameTitle';
import {createOnlineClient} from '@/class/OnlineClient';
import {getMameService} from '@/services';
import type {ChampionLine, GameMediaType} from '@/class/MauiApiClient';
import {fetchRankingAvatar, rankingAvatarUrl} from '@/class/RankingBoard';
import {CHAMPION_SHOWN_MS, championPictureUrl, fetchChampionPicture, getChampionMediaPath} from '@/class/ChampionsScreen';

// The champions of the day (ChampionsScreen.ts), under Home.vue's "Champions" title while the
// cabinet is idle: one after the other, each leaving to the left as the next comes in from the
// right, the champion astride the end of its game's marquee as on the list of games. Home.vue
// sends it away at the first key.
const props = defineProps<{champions: ChampionLine[]}>();

const index = ref(0);
// The first champion's pieces come in one after the other from their sides (style's .intro); the
// next ones slide in whole.
const intro = ref(true);
const current = computed(() => props.champions[index.value % props.champions.length]);
const gameName = computed(() => splitGameTitle(current.value.description).shortname);

// `<romname>/<type>` -> address; the champions' avatars by player.
const pictures = reactive<Record<string, string>>({});
const avatars = reactive<Record<string, string>>({});
// A landscape flyer is turned as the list of games turns it, known once read.
const landscape = reactive<Record<string, boolean>>({});

const TYPES: GameMediaType[] = ['marquee', 'flyer', 'logo'];

function folderOf(type: GameMediaType): string | null {
    try {
        const mame = getMameService();
        return type === 'marquee' ? mame.marqueePath : type === 'flyer' ? mame.flyerPath : mame.logoPath;
    } catch {
        return null;
    }
}

function setPicture(champion: ChampionLine, type: GameMediaType, url: string) {
    pictures[`${champion.romname}/${type}`] = url;
    if (type === 'flyer') {
        const picture = new Image();
        picture.onload = () => {
            landscape[champion.romname] = picture.naturalWidth > picture.naturalHeight;
        };
        picture.src = url;
    }
}

let timer: number | undefined;
onMounted(async () => {
    timer = window.setInterval(() => {
        intro.value = false;
        index.value = (index.value + 1) % props.champions.length;
    }, CHAMPION_SHOWN_MS);
    const cache = getChampionMediaPath();
    const missing: {champion: ChampionLine; type: GameMediaType}[] = [];
    for (const champion of props.champions) {
        for (const type of TYPES) {
            const url = championPictureUrl(champion.romname, champion[type], {local: folderOf(type), cache});
            if (url) {
                setPicture(champion, type, url);
            } else if (champion[type]) {
                missing.push({champion, type});
            }
        }
        const avatar = rankingAvatarUrl(champion);
        if (avatar) {
            avatars[champion.playerId] = avatar;
        }
    }
    // What the cabinet does not have, downloaded in the champions' order: shown once there.
    const client = await createOnlineClient().catch(() => null);
    if (!client) {
        return;
    }
    for (const {champion, type} of missing) {
        const url = await fetchChampionPicture(champion, type, (romname, media) => client.getGameMedia(romname, media), cache)
            .catch(() => null);
        if (url) {
            setPicture(champion, type, url);
        }
    }
    for (const champion of props.champions) {
        if (champion.avatar && !avatars[champion.playerId]) {
            const url = await fetchRankingAvatar(champion, playerId => client.getAvatar(playerId)).catch(() => null);
            if (url) {
                avatars[champion.playerId] = url;
            }
        }
    }
});

onUnmounted(() => clearInterval(timer));
</script>

<style scoped>
    .champions-screen {
        position: absolute;
        inset: 0;
        z-index: 3;
        pointer-events: none;
        overflow: hidden;
    }
    .champion {
        position: absolute;
        inset: 0;
    }
    /* The flyer where the list of games has it (Home.vue's .flyer-container). */
    .champion-flyer {
        position: absolute;
        right: -3%;
        top: -5%;
        bottom: -5%;
        width: 40%;
        container-type: size;
        /* Over the band that runs under it. */
        z-index: 2;
    }
    .flyer {
        width: 100%;
        height: 100%;
        transform: rotateZ(-4deg);
        background-repeat: no-repeat;
        background-size: cover;
        box-shadow: 0 0 30px #000;
    }
    .flyer.landscape {
        position: absolute;
        top: 50%;
        left: 50%;
        width: 100cqh;
        height: 100cqw;
        transform: translate(-50%, -50%) rotateZ(-94deg);
    }
    /* The marquee as the selected one of the list (Games.vue), the champion astride its end and
       "1ST" astride its start (Champions.vue, the hiscores front's champions). */
    .champion-marquee {
        position: absolute;
        top: 27vh;
        left: 6vw;
        width: 48vw;
        aspect-ratio: 32 / 10;
        border-radius: 5px;
        box-shadow: 0 0 30px #000;
        /* Its champion may run over the flyer. */
        z-index: 3;
    }
    .marquee-art, .marquee-logo, .marquee-name {
        position: absolute;
        inset: 0;
        width: 100%;
        height: 100%;
        border-radius: 5px;
        overflow: hidden;
    }
    .marquee-art {
        object-fit: cover;
        filter: saturate(2);
    }
    .marquee-logo, .marquee-name {
        display: grid;
        place-items: center;
        background: #061824;
    }
    .marquee-logo img {
        width: 80%;
        height: 80%;
        object-fit: contain;
    }
    .marquee-name, .place, .game-name, .champion-band {
        font-family: 'Arcade_I', sans-serif;
        color: #fff513;
        text-shadow: 0 0 30px rgba(237, 106, 10, 0.8), 0 3px 0 rgb(255, 81, 0), 0 5px 20px rgba(255, 81, 0, 0.5),
            0 6px 5px rgba(242, 0, 10, 0.7), 0 8px 5px rgb(0, 0, 0);
    }
    .marquee-name {
        font-size: 2.5vw;
    }
    .place {
        position: absolute;
        top: 0;
        left: 0;
        font-size: 4vw;
        line-height: 1;
        transform: translate(-35%, -45%) rotateZ(-6deg);
    }
    .avatar {
        position: absolute;
        top: 50%;
        right: 0;
        /* As tall as the marquee (48vw at 32 / 10), centred on its end. */
        width: 15vw;
        height: 15vw;
        box-sizing: border-box;
        border-radius: 50%;
        overflow: hidden;
        border: 0.8vh solid #ffd700;
        box-shadow: 0 0 30px #000;
        transform: translate(50%, -50%);
    }
    .avatar img {
        width: 100%;
        height: 100%;
        object-fit: cover;
    }
    .game-name {
        position: absolute;
        top: calc(27vh + 15vw + 3vh);
        left: 6vw;
        width: 48vw;
        margin: 0;
        text-align: center;
        font-size: 1.3vw;
    }
    /* As a row of the hiscores table (Hiscores.vue): the initials over the score, across from how
       long and over how many. */
    .champion-band {
        position: absolute;
        left: 0;
        right: 0;
        bottom: 12vh;
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 2vh 44vw 2vh 6vw;
        background-color: rgba(6, 24, 36, 0.9);
        box-shadow: 0 0 65px rgb(0, 0, 0);
    }
    .who {
        display: flex;
        flex-direction: column;
        gap: 1vh;
    }
    .pseudo {
        font-size: 3vw;
    }
    .score, dd {
        color: #fff;
        text-shadow: none;
    }
    .score {
        font-size: 1.6vw;
    }
    dl {
        display: flex;
        gap: 4vw;
        margin: 0;
        text-align: center;
    }
    dt {
        font-size: 0.8vw;
    }
    dd {
        margin: 1vh 0 0;
        font-size: 2.6vw;
    }

    /* The first champion, piece by piece: the flyer from the right, the marquee from the left,
       "1ST" dropping on it, the champion popping astride its end, the game's name, then the band
       from below. */
    .intro .champion-flyer {
        animation: from-right 0.6s ease-out both;
    }
    .intro .champion-marquee {
        animation: from-left 0.6s ease-out 0.3s both;
    }
    .intro .place {
        animation: place-drop 0.5s ease-out 0.8s both;
    }
    .intro .avatar {
        animation: avatar-pop 0.6s ease-out 1s both;
    }
    .intro .game-name {
        animation: fade-up 0.5s ease-out 1.3s both;
    }
    .intro .champion-band {
        animation: from-below 0.6s ease-out 1.4s both;
    }
    @keyframes from-right {
        from { transform: translateX(110%); }
        to { transform: translateX(0); }
    }
    @keyframes from-left {
        from { transform: translateX(-120%); opacity: 0; }
        to { transform: translateX(0); opacity: 1; }
    }
    @keyframes place-drop {
        from { transform: translate(-35%, -300%) rotateZ(-30deg); opacity: 0; }
        to { transform: translate(-35%, -45%) rotateZ(-6deg); opacity: 1; }
    }
    @keyframes avatar-pop {
        0% { transform: translate(50%, -50%) scale(0); }
        70% { transform: translate(50%, -50%) scale(1.2); }
        100% { transform: translate(50%, -50%) scale(1); }
    }
    @keyframes fade-up {
        from { transform: translateY(2vh); opacity: 0; }
        to { transform: translateY(0); opacity: 1; }
    }
    @keyframes from-below {
        from { transform: translateY(150%); }
        to { transform: translateY(0); }
    }

    /* One champion leaves to the left as the next comes in from the right. */
    .champion-enter-active, .champion-leave-active {
        transition: transform 0.7s ease-in-out, opacity 0.7s ease-in-out;
    }
    .champion-enter-from {
        transform: translateX(100vw);
        opacity: 0;
    }
    .champion-leave-to {
        transform: translateX(-100vw);
        opacity: 0;
    }
</style>
