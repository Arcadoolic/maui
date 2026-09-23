<template>
    <div>
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
    div {
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
    p {
        margin: 6px 0;
    }
    * {
        color: white
    }
    .url {
        font-weight: bold;
        overflow-wrap: anywhere;
    }
</style>
