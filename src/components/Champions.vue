<template>
    <div class="champions">
        <div class="championsContainer" v-if="champions.length">
            <div v-for="(champion, index) of champions" :key="champion.id_hiscore" class="champion" :style="{right: (index * 10) + '%'}">
                <img v-if="getAvatar(champion.user)" :src="getAvatar(champion.user)" alt="">
                <img v-else src="../assets/defaultPlayer.png" alt="">
            </div>
        </div>
        <img v-else class="default" src="../assets/hiscores.svg" alt="">
    </div>
</template>

<script setup lang="ts">
import {ref, watch, onMounted, onUnmounted} from 'vue';
import Game from '@/model/Game.model';
import User from '@/model/User.model';
import Hiscore from '@/model/Hiscore.model';
import {join} from 'path';
import {format} from 'url';
import {emitter} from '@/emitter';
import {findAvatarFile} from '@/class/AvatarFiles';
import {getConfiguration, getUserService} from '@/services';
import * as SequelizeTS from 'sequelize-typescript';

const Sequelize = SequelizeTS.Sequelize;

const props = defineProps<{game: Game}>();

const champions = ref<Hiscore[]>([]);
const loading = ref(true);
const avatars = ref<string[]>([]);

async function onGameChange() {
    loading.value = true;
    const result = await props.game.$get(
        'hiscores',
        {
            // required: a deleted player's scores stay in the database but are not shown
            include: [{model: User, required: true}],
            attributes: {include: [[Sequelize.fn('MAX', Sequelize.col('score')), 'max_score']]},
            limit: 3,
            order: [['score', 'DESC']],
            group: ['user.id_user'],
        },
    ) as Hiscore[] || [];
    champions.value = result.reverse();
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
    emitter.on('hiscores-loaded', onGameChange);
});

// `emitter` is a module-level mitt singleton, so it outlives every component instance that
// subscribes to it. Without this, each mount leaves behind a handler closed over a destroyed
// component's props and refs, and they accumulate for the life of the process. The Vue 2 original
// never called `EventBus.$off` either, but there the bus was a Vue instance torn down with the
// app; here nothing ever removes the handler but this.
onUnmounted(() => {
    emitter.off('game-quit', onGameChange);
    emitter.off('hiscores-loaded', onGameChange);
});
</script>

<style scoped>
    .championsContainer {
        height: 100%;
        width: 100%;
        position: relative;
    }

    .champion {
        display: inline-block;
        height: 100%;
        right: 0;
        position: absolute;
    }

    .champion:nth-child(1) {
        z-index: 1;
    }

    .champion:nth-child(2) {
        z-index: 2;
    }

    .champion:nth-child(3) {
        z-index: 3;
    }

    img {
        height: 100%;
    }

    .champion img {
        aspect-ratio: 1 / 1;
        object-fit: cover;
        border-radius: 50%;
    }

    .default {
        position: absolute;
        right: 0;
    }
</style>
