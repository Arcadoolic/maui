<template>
    <div class="champions">
        <div class="championsContainer" v-if="champions.length">
            <div v-for="(champion, index) of champions" class="champion" :style="{right: (index * 10) + '%'}">
                <!--<img :src="champion.icon" :alt="champion.name">-->
                <p style="color: red">{{champion.user.pseudo_3}}</p>
            </div>
        </div>
        <img class="default" v-else src="../assets/hiscores.svg" alt="">
    </div>
</template>

<script lang="ts">
import {Component, Prop, Vue, Watch} from 'vue-property-decorator';
import Game from '@/model/Game.model';
import User from '@/model/User.model';
import {Sequelize} from 'sequelize-typescript';

@Component
export default class Champions extends Vue {
    @Prop({required: true, type: Game})
    protected game!: Game;

    protected champions: Hiscore[] = [];
    protected loading = true;

    public async mounted() {
        await this.onGameChange();
    }

    @Watch('game')
    public async onGameChange() {
        this.loading = true;
        this.champions = await this.game.$get('hiscores', {include: [{model: User}], limit: 3, order: [['score', 'DESC']], group: ['hiscore.id_user']}) as Hiscore[] || [];
        this.loading = false;
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
