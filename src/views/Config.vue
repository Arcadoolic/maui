<template>
    <div>
        <p>Merci de vous connecter depuis un navigateur sur cette machine à</p>
        <p class="url">http://localhost:{{ boServerPort }}</p>
        <p>pour configurer l'application.</p>
    </div>
</template>

<script lang="ts">
    import {Component, Vue} from 'vue-property-decorator';
    import {BO_SERVER_PORT} from '@/boServerPort';

    @Component
    export default class Config extends Vue {
        protected boServerPort = BO_SERVER_PORT;
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
