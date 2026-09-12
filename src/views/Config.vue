<template>
    <div>
        <p>Merci de vous connecter depuis un navigateur sur cette machine pour configurer l'application :</p>
        <p class="url"><a href="#" @click.prevent="openConfigUrl">Cliquez-ici</a></p>
    </div>
</template>

<script lang="ts">
    import {Component, Vue} from 'vue-property-decorator';
    import {BO_SERVER_PORT} from '@/boServerPort';
    import * as remote from '@electron/remote';

    @Component
    export default class Config extends Vue {
        protected boServerPort = BO_SERVER_PORT;

        protected get configUrl() {
            return `http://localhost:${this.boServerPort}`;
        }

        // Opened in the OS's default browser (not navigated to in this frameless kiosk window)
        // - the whole point is to configure the app from a real browser, per the message above.
        protected openConfigUrl() {
            remote.shell.openExternal(this.configUrl);
        }
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
