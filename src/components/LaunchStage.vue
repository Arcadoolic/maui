<template>
    <div class="launchStage">
        <template v-if="loaded">
            <template v-if="record">
                <div class="podium">
                    <div v-for="row of podium" :key="row.player" class="champion" :class="'place-' + (champions.indexOf(row) + 1)">
                        <img v-if="row.avatar" :src="row.avatar" alt="" :style="{backgroundColor: avatarColor(row.pseudo3)}">
                        <img v-else src="../assets/defaultPlayer.png" alt="" :style="{backgroundColor: avatarColor(row.pseudo3)}">
                    </div>
                </div>
                <p class="record">Record <span class="name">{{record.pseudo3}}</span> <span class="score">{{record.score}}</span></p>
                <p v-if="podiumFrom" class="goal">Beat <span class="score">{{podiumFrom.score}}</span> for the podium</p>
                <p v-else class="goal">A place on the podium is free</p>
            </template>
            <p v-else class="getReady">Get ready</p>
        </template>
    </div>
</template>

<script setup lang="ts">
import {ref, computed, onMounted} from 'vue';
import Game from '@/model/Game.model';
import {loadChampions, type BoardRow} from '@/class/LeaderboardSource';
import {avatarColor} from '@/class/AvatarColor';
import Log from 'electron-log';

// Shown while the game picked is starting (Home.vue's startGame()), until MAME takes the screen.
// Who is about to play is not known yet (asked after the game), so the stage tells everyone what
// the podium asks: the record, and the score to beat to get on it while it is full.
const props = defineProps<{game: Game}>();

// The best 3 players, best first (LeaderboardSource.ts).
const champions = ref<BoardRow[]>([]);
const loaded = ref(false);
const record = computed(() => champions.value[0] ?? null);
const podiumFrom = computed(() => champions.value.length >= 3 ? champions.value[2] : null);
// Drawn as a podium: the 2nd on the left, the 1st in the middle, the 3rd on the right.
const podium = computed(() => [champions.value[1], champions.value[0], champions.value[2]].filter(Boolean));

onMounted(async () => {
    try {
        champions.value = props.game.hi ? await loadChampions(props.game) : [];
    } catch (err) {
        Log.warn('[LaunchStage] Podium not read: ' + (err instanceof Error ? err.message : String(err)));
    }
    loaded.value = true;
});
</script>

<style scoped>
    /* Under the picked marquee (Games.vue's .launching), left of the flyer. */
    .launchStage {
        position: absolute;
        left: 4%;
        width: 52%;
        top: 64%;
        height: 32%;
        z-index: 2;
        pointer-events: none;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: flex-start;
        font-family: 'Arcade_I', sans-serif;
        color: #fff513;
        text-shadow: 0 3px 0 rgb(255, 81, 0), 0 6px 0 #000000;
        /* Comes as the marquee settles: MAME is started right after the launch sound (0.4 s),
           and its window may cover the front a moment later. */
        animation: stage-in 0.3s ease-out 0.3s both;
    }

    .podium {
        display: flex;
        align-items: flex-end;
        justify-content: center;
        gap: 1.5vw;
        height: 15vh;
    }

    /* Sized in vh, not from the podium: in the flex row an image sized in % takes its width from
       the picture itself, a tiny one for a small avatar. */
    .champion {
        flex: none;
        width: 11vh;
        height: 11vh;
        animation: champion-pop 0.4s ease-out 0.45s both;
    }

    .champion.place-1 {
        width: 15vh;
        height: 15vh;
        animation-delay: 0.35s;
    }

    .champion.place-3 {
        animation-delay: 0.55s;
    }

    .champion img {
        display: block;
        width: 100%;
        height: 100%;
        object-fit: cover;
        border-radius: 50%;
        box-sizing: border-box;
        border: 0.5vh solid transparent;
        background-clip: padding-box;
    }

    /* Gold, silver, bronze, as on the marquee (Champions.vue). */
    .place-1 img {
        border-color: #ffd23f;
    }

    .place-2 img {
        border-color: #c9d1d9;
    }

    .place-3 img {
        border-color: #cd7f32;
    }

    p {
        margin: 1.2vh 0 0;
        white-space: nowrap;
    }

    .record {
        font-size: 1.8vw;
    }

    .goal {
        font-size: 1.2vw;
    }

    .score {
        color: #ffffff;
    }

    .getReady {
        margin-top: 5vh;
        font-size: 2.5vw;
        /* A few blinks, not endless: in windowed mode the front stays in view behind the game. */
        animation: blink 0.8s steps(1) 0.6s 6 both;
    }

    @keyframes stage-in {
        0% {
            opacity: 0;
            transform: translateY(3vh);
        }
        100% {
            opacity: 1;
            transform: none;
        }
    }

    @keyframes champion-pop {
        0% {
            transform: scale(0);
        }
        70% {
            transform: scale(1.2);
        }
        100% {
            transform: scale(1);
        }
    }

    @keyframes blink {
        0% {
            opacity: 1;
        }
        50% {
            opacity: 0;
        }
    }
</style>
