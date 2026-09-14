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
import {ref, watch, onMounted} from 'vue';
import Game from '@/model/Game.model';
import User from '@/model/User.model';
import Hiscore from '@/model/Hiscore.model';
import {join} from 'path';
import {format} from 'url';
import {emitter} from '@/emitter';
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
            include: [{model: User}],
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
    if (avatars.value.indexOf(user.pseudo_3 + '.png') >= 0) {
        return format({
            pathname: join(getConfiguration().avatarsPath, user.pseudo_3 + '.png'),
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

    // Preserved as-is: the original never called EventBus.$off here either. Not fixed in this
    // migration - out of scope (only the ControllableVue leak from D2 is an approved fix).
    emitter.on('game-quit', onGameChange);
    emitter.on('hiscores-loaded', onGameChange);
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
