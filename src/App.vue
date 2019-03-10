<template>
    <div id="app">
        <!--<nav :class="{hovered: verticalSelect == 0}">-->
            <!--<router-link to="/">-->
                <!--<p>Home</p>-->
            <!--</router-link>-->
            <!--<router-link to="/">-->
                <!--<p>Search</p>-->
            <!--</router-link>-->
            <!--<router-link to="/">-->
                <!--<p>Options</p>-->
            <!--</router-link>-->
        <!--</nav>-->
        <router-view v-if="!loading && !error && gamePadCount"></router-view>

        <div class="info-messages">
            <p v-if="loading" class="loading">Chargement</p>
            <p v-if="error" class="error">{{error}}</p>
            <p v-if="!gamePadCount">Waiting for a controller</p>
        </div>
    </div>
</template>

<script lang="ts">
import {Component, Vue} from 'vue-property-decorator';
import Config from '@/class/Config.class';
import GameService from '@/class/GameService.class';

@Component
export default class App extends Vue {
    protected loading = true;
    protected error: string|null = null;

    protected gamePadCount: number = 0;

    protected animtationFrameRequest: number|null = null;

    protected xboxOneMapping: any = {
        buttons: {
            0: 'Enter',
            12: 'ArrowUp',
            13: 'ArrowDown',
            14: 'ArrowLeft',
            15: 'ArrowRight'
        },
    };

    protected gamepadKeyPressed: boolean[][] = [];

    public created() {

        const config: Config = this.$store.getters.config;
        const mame = this.$store.getters.mame;
        const gameList = this.$store.getters.gameList;
        try {
            config.load();
            mame.init(config.mameIniPath);

            gameList.init(config.gamesJsonPath);

            const gameService = new GameService(config, mame, gameList);
            gameService.refreshGameDir();
            gameList.init(config.gamesJsonPath);
            gameService.loadGamesMarquee();
            this.loading = false;

            this.initGamepads();
        } catch (e) {
            console.error(e);
            this.loading = false;
            this.error = e.toString();
            return false;
        }
    }

    public initGamepads() {
        window.addEventListener('gamepadconnected', (e) => {
            this.gamePadCount++;
            if (this.gamePadCount === 1) {
                this.gamepadsButtons();
            }
        });

        window.addEventListener('gamepaddisconnected', (e) => {
            this.gamePadCount--;
            if (!this.gamePadCount) {
                if (this.animtationFrameRequest) {
                    cancelAnimationFrame(this.animtationFrameRequest);
                }
            }
        });
    }

    public gamepadsButtons() {
        for (const gamepadsKey in navigator.getGamepads()) {
            if (!gamepadsKey) {
                continue;
            }
            const gamepad: Gamepad|null = navigator.getGamepads()[gamepadsKey];
            if (!gamepad || !gamepad.connected || !gamepad.buttons) {
                continue;
            }

            gamepad.buttons.forEach((button: GamepadButton, index) => {
                let eventName: string|null = null;
                if (this.xboxOneMapping.buttons[index]) {
                    if (!this.gamepadKeyPressed[gamepadsKey]) {
                        this.gamepadKeyPressed[gamepadsKey] = [];
                    }
                    if (button.pressed) {
                        eventName = 'gamepadKeydown';
                        this.gamepadKeyPressed[gamepadsKey][index] = true;
                    } else if (this.gamepadKeyPressed[gamepadsKey][index]) {
                        eventName = 'gamepadKeyup';
                        this.gamepadKeyPressed[gamepadsKey][index] = false;
                    }

                    if (eventName) {
                        const event = new CustomEvent(eventName, {
                            detail: {
                                key: this.xboxOneMapping.buttons[index],
                                value: button.value,
                            },
                        });
                        window.dispatchEvent(event);
                    }
                }
            });
        }

        this.animtationFrameRequest = requestAnimationFrame(this.gamepadsButtons.bind(this));
    }
}
</script>

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

    body{
        background-color: #000000;
        background-image:  url('./assets/background.jpg');
        background-size: cover;
        background-repeat: repeat;
        background-position: 0 0;
        font-family: 'Arcade_I', sans-serif;
        transform: translateZ(0);
        height: 100%;
        width: 100%;
    }

    #app {
        height: 100%;
        width: 100%;
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

    nav {
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        z-index: 2;
        height: 5px;
        background: red;
        transition: height 0.2s;
    }

    nav.hovered {
        height: 60px;
    }

    nav p {
        padding: 0;
        margin: 0;
        display: none;
    }

    nav.hovered p {
        display: inline-block;
    }

    .info-messages {
        width: 100%;
        height: 100%;
        display: table;
    }
        .info-messages > * {
            display: table-cell;
            vertical-align: middle;
            text-align: center;
            color: white;
        }

    .loading {
        font-size: 5vw;
        color: blue;
    }

    .error {
        font-size: 3vw;
        color: red;
    }
</style>
