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
import {totalmem} from 'os';
import {resolveUiMode, type UiModeHardware} from '@/class/UiMode';
import {getConfiguration, setUiMode} from '@/services';

const focused = ref(true);

// Decided once, before any view is set up (they read isLite()): changing the BO's setting takes
// the front's reload that every BO save already triggers.
function readHardware(): UiModeHardware {
    const hardware: UiModeHardware = {totalMemBytes: totalmem()};
    try {
        const status = remote.app.getGPUFeatureStatus() as unknown as Record<string, string>;
        hardware.gpuCompositing = status.gpu_compositing;
    } catch {
        // Left undefined: the memory alone decides.
    }
    return hardware;
}

const configuration = getConfiguration();
configuration.load();
const uiMode = resolveUiMode(configuration.uiMode, readHardware());
setUiMode(uiMode);
document.documentElement.classList.toggle('lite', uiMode === 'lite');

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

    /***************************************/
    /*/////////////// LITE ////////////////*/
    /***************************************/
    /* Lite mode (UiMode.ts): the same screen without what a software compositor pays for on every
       frame. !important, to win over the components' scoped rules from this one place. */
    html.lite body {
        transform: none;
    }
    html.lite *, html.lite *::before, html.lite *::after {
        transition: none !important;
        filter: none !important;
        box-shadow: none !important;
    }
    /* The only endless animation, which kept the compositor drawing 60 frames a second on an idle
       screen. Loader.vue's own (a long press filling up) runs for 2 seconds and stays. */
    html.lite .online-badge, html.lite .online-badge::before {
        animation: none !important;
    }
    /* Blurred shadows replaced by a solid one: the titles keep their relief. */
    html.lite .gameTitle, html.lite .categoryTitle, html.lite .no-games h1,
    html.lite .hiscores, html.lite .letters, html.lite .letters > div.selected {
        text-shadow: 0 3px 0 rgb(255, 81, 0), 0 6px 0 #000000 !important;
    }
    html.lite .home {
        background-image: url(./assets/background-lite.jpg);
    }
    html.lite .home.empty {
        background-image: none;
    }
    /* Without its blur and darkening filter, the flyer behind a logo is dimmed over black. */
    html.lite .flyerLogoFallback {
        background-color: #000000;
    }
    html.lite .flyerLogoFallback .flyerBackground {
        opacity: 0.5;
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
