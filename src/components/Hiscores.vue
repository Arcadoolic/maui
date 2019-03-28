<template>
    <div>
        <span v-for="hiscore of game.hiscores.classic[0]">
            {{hiscore.RANK}} - {{hiscore.NAME && hiscore.NAME.trim() !== '' ? hiscore.NAME : '???'}} - {{hiscore.SCORE}}
        </span>
    </div>
</template>

<script lang="ts">
import ControllableVue from '@/ControllableVue.vue';
import {Component, Prop} from 'vue-property-decorator';
import Game from '@/class/Game.class';

@Component
export default class Hiscores extends ControllableVue {
    @Prop({required: true, type: Game}) protected game!: Game;
}
</script>

<style scoped>
    div {
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
</style>
