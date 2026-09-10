<template>
    <div class="champions">
        <div class="championsContainer" v-if="champions.length">
            <div v-for="(champion, index) of champions" class="champion" :style="{right: (index * 10) + '%'}">
                <img v-if="getAvatar(champion.user)" :src="getAvatar(champion.user)" alt="">
                <img v-else src="../assets/defaultPlayer.png" alt="">
            </div>
        </div>
        <img v-else class="default" src="../assets/hiscores.svg" alt="">
    </div>
</template>

<script lang="ts">
    import {Component, Prop, Vue, Watch} from 'vue-property-decorator';
    import Game from '@/model/Game.model';
    import User from '@/model/User.model';
    import Hiscore from '@/model/Hiscore.model';
    import Config from '@/class/Config.class';
    import {join} from 'path';
    import {format} from 'url';
    import {EventBus} from '@/EventBus';
    import * as SequelizeTS from 'sequelize-typescript';
    const Sequelize = SequelizeTS.Sequelize;

    @Component
    export default class Champions extends Vue {
        @Prop({required: true, type: Game})
        protected game!: Game;

        protected champions: Hiscore[] = [];
        protected loading = true;
        protected avatars: string[] = [];
        protected config!: Config;

        public async mounted() {
            this.avatars = this.$store.getters.userService.getAvatars();
            this.config = this.$store.getters.configuration;
            await this.onGameChange();

            EventBus.$on('game-quit', this.onGameChange);
            EventBus.$on('hiscores-loaded', this.onGameChange);
        }

        @Watch('game')
        public async onGameChange() {
            this.loading = true;
            this.champions = await this.game.$get(
                'hiscores',
                {include: [{model: User}], attributes: {include: [[Sequelize.fn('MAX', Sequelize.col('score')), 'max_score']]}, limit: 3, order: [['score', 'DESC']], group: ['user.id_user']},
            ) as Hiscore[] || [];
            this.champions = this.champions.reverse();
            this.loading = false;
        }

        public getAvatar(user: User) {
            if (this.avatars.indexOf(user.pseudo_3 + '.png') >= 0) {
                return format({
                    pathname: join(this.config.avatarsPath, user.pseudo_3 + '.png'),
                    protocol: 'file',
                    slashes: true,
                });
            }
            return false;
        }
    }
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

    .default {
        position: absolute;
        right: 0;
    }
</style>
