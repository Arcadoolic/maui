<template>
    <div class="controllers">
        <template v-if="!gamepadCount">
            No controller
            <small>Press a button on your controller</small>
        </template>
        <template v-else>
            {{gamepadCount}} controller<template v-if="gamepadCount > 1">s</template>
        </template>
    </div>
</template>

<script lang="ts">
import {Component, Vue, Watch} from "vue-property-decorator";
import * as GamepadsClass from '../class/Gamepads.class';

@Component
export default class Gamepads extends Vue {
    protected gamepadCount: number = 0;

    public mounted() {
        window.addEventListener('gamepadCountUpdate', (e: CustomEvent) => {
            this.gamepadCount = e.detail.gamepadCount;
        })
    }
}
</script>

<style scoped>
    .controllers {
        display: block;
        position: absolute;
        bottom: 0;
        left: 25%;
        color: #fff513;
        font-size: 0.6vw;
        text-align: center;
        padding: 1% 2%;
        background: linear-gradient(to top, rgba(0, 30, 255, 0.25) 50%, transparent);
        width: 15%;
        perspective: 460px; /** TODO : Perspective not workinmg */
        perspective-origin: 50% 50%;
        text-shadow:
            0 0 30px rgba(237, 106, 10, 0.8),
            0 3px 0 rgb(255, 81, 0),
            0 5px 20px rgba(255, 81, 0, 0.5),
            0 6px 5px rgba(242, 0, 10, 0.7),
            0 12px 16px rgba(0, 0, 0, 1),
            6px 12px 9px rgba(0, 0, 0, 1);
        transform: rotateX(15deg) rotateY(0deg) rotateZ(0deg);
        filter: saturate(1.3);
    }
    .controllers small {
        display: block;
        padding: 10%;
        line-height: 150%;
    }
</style>
