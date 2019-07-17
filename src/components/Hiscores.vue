<template>
    <div class="hiscores">
        <p v-if="loading">Loading hiscores...</p>
        <template v-else>
            <div class="hiscore" :class="{first: index === 0}" v-for="(score, index) of scores">
                <div class="icon" v-if="score.rank !== '1'">
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
                <div class="icon" v-if="score.rank === '1'">
                    <img :src="getAvatar(score.user)" v-if="getAvatar(score.user)" alt="">
                    <img v-else src="../assets/defaultPlayer.png" alt="">
                </div>
            </div>
        </template>
    </div>
</template>

<script lang="ts">
    import ControllableVue from '@/ControllableVue';
    import {Component, Prop, Watch} from 'vue-property-decorator';
    import Game from '@/model/Game.model';
    import Hiscore from '@/model/Hiscore.model';
    import User from '@/model/User.model';
    import Config from '@/class/Config.class';
    import {join} from 'path';
    import {format} from 'url';
    import {EventBus} from '@/EventBus';

    @Component
    export default class Hiscores extends ControllableVue {
        @Prop({required: true, type: Game})
        protected game!: Game;

        protected scores: Hiscore[] = [];
        protected loading = true;
        protected avatars: string[] = [];
        protected config!: Config;

        public async mounted() {
            this.avatars = this.$store.getters.userService.getAvatars();
            this.config = this.$store.getters.configuration;
            await this.onGameChange();

            EventBus.$on('game-quit', this.onGameChange);
        }

        @Watch('game')
        public async onGameChange() {
            this.loading = true;
            this.scores = await this.game.$get(
                'hiscores',
                {include: [{model: User}], limit: 10, order: [['score', 'DESC']], group: ['score', 'user.id_user']},
            ) as Hiscore[] || [];
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
        border-radius: 50%;
        max-width: 100%;
    }

    .info {
        width: 70%;
    }

    .info > * {
        display: inline-block;
    }

    .info .place {
        font-size: 2vw;
        letter-spacing: -10px;
    }

    .info .score_name {
        margin-left: .6vw;
    }

    .info .score {
        color: #FFF;
        text-shadow: none;
        line-height: 1.2vw;
    }

    .hiscore.first {
        width: 0;
        position: absolute;
        top: -20%;
        font-size: 2vh;
        left: -50%;
        right: 0;
        margin: 0 auto;
    }

    .hiscore.first .icon img {
        border-radius: 0;
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
