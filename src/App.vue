<template>
    <div id="app">
        <router-view :focused="focused"></router-view>
        <OnlineBadge/>
    </div>
</template>

<script setup lang="ts">
import {ref, onMounted} from 'vue';
import * as remote from '@electron/remote';
import Gamepads from '@/class/Gamepads.class';
import OnlineBadge from '@/components/OnlineBadge.vue';

const focused = ref(true);

onMounted(() => {
    // Electron event
    remote.getCurrentWindow().on('blur', () => {
        Gamepads.stopGamepadsListeners();
        focused.value = false;
    });
    remote.getCurrentWindow().on('focus', () => {
        focused.value = true;
        Gamepads.init();
    });
});
</script>

<style src="./assets/font-awesome/css/all.min.css"></style>
<style>
    /***************************************/
    /*/////////////// BASE ////////////////*/
    /***************************************/
    html, body, div, span, applet, object, iframe,
    h1, h2, h3, h4, h5, h6, p, blockquote, pre,
    a, abbr, acronym, address, big, cite, code,
    del, dfn, em, img, ins, kbd, q, s, samp,
    small, strike, strong, sub, sup, tt, var,
    b, u, i, center,
    dl, dt, dd, ol, ul, li,
    fieldset, form, label, legend,
    table, caption, tbody, tfoot, thead, tr, th, td,
    article, aside, canvas, details, embed,
    figure, figcaption, footer, header,
    menu, nav, output, ruby, section, summary,
    time, mark, audio, video {
        margin: 0;
        padding: 0;
        border: 0;
        font-size: inherit;
        font-weight: normal;
        vertical-align: baseline;
    }
    html{ font-size: 100%; }
    article, aside, details, figcaption, figure,
    footer, header, menu, nav, section { display: block; }
    body{ line-height: 1; }
    ol, ul{ list-style: none; }
    table { border-collapse: collapse; border-spacing: 0; }
    * { box-sizing: border-box; }

    html {
        height: 100%;
        width: 100%;
        overflow: hidden;
    }

    body {
        height: 100%;
        width: 100%;
        font-family: 'Arcade_I', sans-serif;
        transform: translateZ(0);
    }

    #app {
        height: 100%;
        width: 100%;
    }
    /* Windowed mode (Home.vue): the window is frameless, so the whole UI acts as its title bar
       and drags it around. The front is driven by joystick/keyboard; the few mouse targets opt out. */
    html.window-draggable #app {
        -webkit-app-region: drag;
    }
    html.window-draggable a, html.window-draggable button, html.window-draggable input,
    html.window-draggable select, html.window-draggable textarea {
        -webkit-app-region: no-drag;
    }

    /******************************************/
    /*/////////////// POLICES ////////////////*/
    /******************************************/
    @font-face {
        font-family: Arcade_I;
        src: url('./assets/fonts/ARCADE_I.TTF');
    }

    @font-face {
        font-family: Arcade_N;
        src: url('./assets/fonts/ARCADE_N.TTF');
    }

    @font-face {
        font-family: Arcade_R;
        src: url('./assets/fonts/ARCADE_R.TTF');
    }
</style>
