<template>
    <div class="hiscores">
        <div class="hiscore" :class="{first: hiscore.RANK === '1'}" v-for="hiscore of game.hiscores.classic[0]">
            <div class="icon" v-if="hiscore.RANK !== '1'">
                <img :src="players.getPlayerIcon(hiscore.NAME)" :alt="hiscore.NAME" v-if="players.playerExist(hiscore.NAME)">
                <img src="../assets/defaultPlayer.png" v-else>
            </div>
            <div class="info">
                <span class="place">{{hiscore.RANK}}</span>
                <div class="score_name">
                    <p class="name">{{hiscore.NAME && hiscore.NAME.trim() !== '' ? hiscore.NAME : '???'}}</p>
                    <p class="score">{{hiscore.SCORE}}</p>
                </div>
            </div>
            <div class="icon" v-if="hiscore.RANK === '1'">
                <img :src="players.getPlayerIcon(hiscore.NAME)" :alt="hiscore.NAME" v-if="players.playerExist(hiscore.NAME)">
                <img src="../assets/defaultPlayer.png" v-else>
            </div>
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
        width: 45%;
        height: 35%;
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
