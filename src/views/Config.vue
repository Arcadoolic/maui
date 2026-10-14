<template>
    <div class="first-run">
        <SetupChecklist :progress="progress"/>
    </div>
</template>

<script setup lang="ts">
import * as remote from '@electron/remote';
import SetupChecklist from '@/components/SetupChecklist.vue';
import {useSetupProgress} from '@/composables/useSetupProgress';

// No configuration yet: the setup guide's steps, done from the BO on another screen. Init.vue's
// splash window is too small for them.
remote.getCurrentWindow().setSize(640, 560);
remote.getCurrentWindow().center();

const progress = useSetupProgress();
</script>

<style scoped>
    /* The window is made 640x560 above: centered in it, with side padding and wrapping so nothing
       gets cut. */
    .first-run {
        position: relative;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        box-sizing: border-box;
        width: 100%;
        height: 100vh;
        padding: 0 24px;
        background-color: #000000;
        text-align: center;
        font-size: 17px;
    }
    /* The splash logo behind the message: faint, but still recognizable. */
    .first-run::before {
        content: '';
        position: absolute;
        inset: 16px;
        background: url(../assets/splash_screen_arcade.png) center / contain no-repeat;
        opacity: 0.18;
        pointer-events: none;
    }
    .first-run > * {
        position: relative;
    }
</style>
