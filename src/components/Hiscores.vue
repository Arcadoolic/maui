<template>
    <div class="hiscores">
        <p v-if="loading">Loading hiscores...</p>
        <p v-else-if="!scores.length" class="no-hiscores">No Hiscores Yet !</p>
        <template v-else>
            <div class="hiscore" :class="{first: index === 0}" v-for="(score, index) of scores" :key="score.id_hiscore">
                <div class="icon">
                    <img :src="getAvatar(score.user)" v-if="getAvatar(score.user)" alt="">
                    <img v-else src="../assets/defaultPlayer.png" alt="">
                </div>
                <div class="info">
                    <span class="place">{{index + 1}}</span>
                    <div class="score_name">
                        <p class="name">{{score.user.pseudo_3}}</p>
                        <p class="score">{{score.score}}</p>
                    </div>
                </div>
            </div>
        </template>
    </div>
</template>

<script setup lang="ts">
import {ref, watch, onMounted, onUnmounted} from 'vue';
import Game from '@/model/Game.model';
import Hiscore from '@/model/Hiscore.model';
import User from '@/model/User.model';
import {join} from 'path';
import {format} from 'url';
import {emitter} from '@/emitter';
import {findAvatarFile} from '@/class/AvatarFiles';
import {getConfiguration, getUserService} from '@/services';

const props = defineProps<{game: Game}>();

// How many scores the table shows: the best one is drawn on its own above the box (.first), the
// rest fill the 3-column grid below it.
const MAX_HISCORES_DISPLAYED = 9;

const scores = ref<Hiscore[]>([]);
const loading = ref(true);
const avatars = ref<string[]>([]);

async function onGameChange() {
    loading.value = true;
    scores.value = await props.game.$get(
        'hiscores',
        {include: [{model: User, required: true}], limit: MAX_HISCORES_DISPLAYED, order: [['score', 'DESC']], group: ['score', 'user.id_user']},
    ) as Hiscore[] || [];
    loading.value = false;
}

function getAvatar(user: User) {
    const avatarFile = findAvatarFile(avatars.value, user.pseudo_3);
    if (avatarFile) {
        return format({
            pathname: join(getConfiguration().avatarsPath, avatarFile),
            protocol: 'file',
            slashes: true,
        });
    }
    return false;
}

watch(() => props.game, onGameChange);

onMounted(async () => {
    avatars.value = getUserService().getAvatars();
    await onGameChange();

    emitter.on('game-quit', onGameChange);
});

// See Champions.vue: `emitter` is a module-level mitt singleton and outlives this component, so
// the handler has to be removed explicitly or every mount leaks one.
onUnmounted(() => {
    emitter.off('game-quit', onGameChange);
});
</script>

<style scoped>
    .hiscores {
        position: absolute;
        right: 10%;
        bottom: 0;
        width: 45%;
        height: 35%;
        background-color: rgba(6, 24, 36, 0.9);
        box-shadow: 0 0 65px rgb(0, 0, 0);
        color: #fff513;
        font-family: 'Arcade_I', sans-serif;
        text-shadow: 0 0 30px rgba(237, 106, 10, 0.8),
        0 3px 0 rgb(255, 81, 0),
        0 5px 20px rgba(255, 81, 0, 0.5),
        0 6px 5px rgba(242, 0, 10, 0.7),
        0 8px 5px rgba(0, 0, 0, 1);
        padding-top: 8vh;
    }

    /* Nobody has a score on this game yet: one message in the middle of the box (absolute, so the
       8vh top padding kept for the first place doesn't push it off-center). */
    .no-hiscores {
        position: absolute;
        top: 0;
        right: 0;
        bottom: 0;
        left: 0;
        margin: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        text-align: center;
        /* The arcade font is wide: at 2.5vw the text took 92% of the box's width, 2.2vw leaves ~10% each side. */
        font-size: 2.2vw;
    }

    .hiscore {
        width: 33%;
        display: table;
        float: left;
    }

    .hiscore > * {
        display: inline-block;
        vertical-align: middle;
    }

    .icon {
        width: 30%;
        padding: 1vh;
    }

    .icon img {
        width: 100%;
        aspect-ratio: 1 / 1;
        object-fit: cover;
        border-radius: 50%;
    }

    .info {
        width: 70%;
    }

    .info > * {
        display: inline-block;
        vertical-align: middle;
    }

    .info .place {
        font-size: 2.5vw;
        letter-spacing: -10px;
    }

    .info .score_name {
        margin-left: 1.2vw;
    }

    .info .score {
        color: #FFF;
        text-shadow: none;
        line-height: 1.2vw;
    }

    .hiscore.first {
        position: absolute;
        top: 0;
        left: 50%;
        transform: translate(-50%, -50%);
        font-size: 2vh;
        white-space: nowrap;
    }

    .hiscore.first .icon {
        width: auto;
    }

    .hiscore.first .icon img {
        width: 6vw;
    }

    .hiscore.first .info {
        width: auto;
    }

    .hiscore.first .info .place {
        font-size: 4vw;
    }

    .hiscore.first .info .score_name {
        font-size: 1.8vw;
        line-height: 2.5vw;
    }

</style>
