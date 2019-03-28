<template>
    <div>
        <ul>
            <li v-for="hiscore of game.hiscores.classic[0]">
                {{hiscore.RANK}} - {{hiscore.NAME && hiscore.NAME.trim() !== '' ? hiscore.NAME : '???'}} - {{hiscore.SCORE}}
            </li>
        </ul>
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
        background-color: red;
        color: white;
        right: 10%;
        bottom: 0;
        width: 30%;
        height: 30%;
    }
</style>
