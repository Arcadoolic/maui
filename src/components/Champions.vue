<template>
    <div class="champions">
        <div class="championsContainer" v-if="champions.length">
            <div v-for="(champion, index) of champions" class="champion" :style="{right: (index * 10) + '%'}">
                <img :src="champion.icon" :alt="champion.name">
            </div>
        </div>
        <img class="default" v-else src="../assets/hiscores.svg" alt="">
    </div>
</template>

<script lang="ts">
import {Component, Prop, Vue, Watch} from 'vue-property-decorator';
import Game from '../class/Game.class';

@Component
export default class Champions extends Vue {
    @Prop({required: true, type: Game}) protected game!: Game;
    protected champions: {name: string, icon: string}[] = [];

    public mounted() {
        this.onGameChange();
    }

    @Watch('game.hiscore')
    public onGameChange() {
        if (!this.game.hiscores || !this.game.hiscores.classic || !this.game.hiscores.classic[0]) {
            return;
        }
        const players = this.$store.getters.players;
        let championsName: string[] = [];
        for (const player of this.game.hiscores.classic[0] as any[]) {
            if (this.champions.length >= 3) { break; }
            if (players.playerExist(player.NAME) && championsName.indexOf(player.NAME) < 0) {
                championsName.push(player.NAME);
                this.champions.push({
                    name: player.NAME,
                    icon: players.getPlayerIcon(player.NAME)
                });
            }
        }
        this.champions = this.champions.reverse();
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
