<template>
    <div class="hiscores">
        <div class="hiscore" :class="{first: hiscore.RANK === '1'}" v-for="hiscore of game.hiscores.classic[0]">
            <span class="place">{{hiscore.RANK}}</span>
            <span class="score">
                <p>{{hiscore.SCORE}}</p>
                <p>{{hiscore.NAME && hiscore.NAME.trim() !== '' ? hiscore.NAME : '???'}}</p>
            </span>
            <span class="icon">
                <img :src="players.getPlayerIcon(hiscore.NAME)" :alt="hiscore.NAME" v-if="players.playerExist(hiscore.NAME)">
                <img src="../assets/defaultPlayer.png" v-else>
            </span>
        </div>
    </div>
</template>

<script lang="ts">
import ControllableVue from '@/ControllableVue.vue';
import {Component, Prop} from 'vue-property-decorator';
import Game from '@/class/Game.class';

@Component
export default class Hiscores extends ControllableVue {
    @Prop({required: true, type: Game}) protected game!: Game;
    protected players = {};

    public mounted() {
        this.players = this.$store.getters.players;
    }
}
</script>

<style scoped>
    .hiscores {
        position: absolute;
        right: 10%;
        bottom: 0;
        width: 40%;
        height: 30%;
        background-color: rgba(6,24,36,0.9);
        box-shadow: 0 0 65px rgb(0, 0, 0);
        color: #fff513;
        font-family: 'Arcade_I', sans-serif;
        text-shadow:
            0 0 30px rgba(237, 106, 10, 0.8),
            0 3px 0 rgb(255, 81, 0),
            0 5px 20px rgba(255, 81, 0, 0.5),
            0 6px 5px rgba(242, 0, 10, 0.7),
            0 8px 5px rgba(0, 0, 0, 1);
    }

    .hiscore {
        width: 33%;
        display: table;
        float: left;
    }
    .hiscore > * {
        display: table-cell;
        vertical-align: middle;
    }
    .place {
        width: 10%;
        font-size: 3em;
    }
    .score {
        width: 50%;
    }
    .icon {
        width: 40%;
    }
    .icon img {
        border-radius: 50%;
        max-width: 100%;
    }

        .hiscore.first {
            position: absolute;
            top: -50%;
            font-size: 2em;
            width: 50%;
        }
            .hiscore.first .icon img {
                border-radius: 0;
            }

</style>
