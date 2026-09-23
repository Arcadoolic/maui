<template>
    <div>
        <p>Configure the app from a browser:</p>
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
    div {
        display: block;
        width: 100%;
        height: 100%;
        background-color: #000000;
        text-align: center;
        padding-top: 100px;
    }
    * {
        color: white
    }
    .url {
        font-weight: bold;
        font-size: 1.2em;
    }
</style>
