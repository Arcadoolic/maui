<template>
    <div class="first-run">
        <p>Configure the App</p>
        <p class="url"><a href="#" @click.prevent="openConfigUrl">{{configUrl}}</a></p>
    </div>
</template>

<script setup lang="ts">
import {BO_SERVER_PORT} from '@/boServerPort';
import * as remote from '@electron/remote';

const configUrl = `http://localhost:${BO_SERVER_PORT}`;

// Opened in the OS's default browser (not navigated to in this frameless kiosk window) - the
// whole point is to configure the app from a real browser, per the message above.
function openConfigUrl() {
    remote.shell.openExternal(configUrl);
}
</script>

<style scoped>
    /* Shown in Init.vue's small square splash window (346x354): centered in it, with side
       padding and wrapping so nothing gets cut. */
    .first-run {
        position: relative;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        box-sizing: border-box;
        width: 100%;
        height: 100vh;
        padding: 0 16px;
        background-color: #000000;
        text-align: center;
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
    p {
        position: relative;
        margin: 6px 0;
        text-shadow: 0 1px 4px #000000;
    }
    * {
        color: white
    }
    .url {
        font-weight: bold;
        font-size: 0.85em;
        overflow-wrap: anywhere;
    }
    /* Same yellow as Home's game titles. */
    .url a {
        color: #fff513;
    }
</style>
