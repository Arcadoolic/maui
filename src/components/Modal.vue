<template>
    <div class="modal-container">
        <div class="modal-background"></div>
        <div class="modal" ref="modal">
            <slot></slot>
        </div>
    </div>
</template>

<script lang="ts">
import {Component, Vue} from 'vue-property-decorator';

@Component
    export default class Modal extends Vue {
        public mounted() {
            const modal = this.$refs.modal as HTMLElement;
            modal.style.top = (window.innerHeight / 2) - (modal.clientHeight / 2) + 'px';
        }

    }
</script>

<style>
    .modal-container {
        position: absolute;
        top: 0;
        bottom: 0;
        display: block;
        width: 100%;
        height: 100%;
        z-index: 9;
    }
    .modal-background {
        width: 100%;
        height: 100%;
        background: rgba(0, 0, 0, 0.8);
    }

    .modal {
        display: inline-block;
        position: absolute;
        background: transparent;
        color: snow;
        width: 640px;
        top: 50%;
        left: 50%;
        margin-left: -320px;
        margin-top: -150px;
        padding: 10px;
        text-align: center;
    }
</style>
