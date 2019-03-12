<template>
    <span>
        <div class="gameTitle" v-if="selectedGame">
            <h1>{{selectedGame.shortname}}</h1>
            <small>({{selectedGame.year}}, {{selectedGame.nplayerString}})</small>
        </div>

        <Games :selectedCategory="selectedCategory" @gameChange="gameChange"></Games>
        <Categories @categoryChange="categoryChange"></Categories>

        <div class="controllers">
            <template v-if="!gamepadCount">
                No controller
                <small>Press a button on your controller</small>
            </template>
            <template v-else>
                {{gamepadCount}} controller<template v-if="gamepadCount > 1">s</template>
            </template>
        </div>
    </span>
    <!--<button v-if="mame.isGameOn" @click.prevent="mame.stop()">Kill</button>-->

</template>

<script lang="ts">
import {Vue, Component} from 'vue-property-decorator';
import GameList from '@/class/GameList.class';
import Categories from '@/components/Categories.vue';
import Mame from '@/class/Mame.class';
import GameCategory from '@/class/GameCategory.class';
import Games from '@/components/Games.vue';
import Game from '@/class/Game.class';
import ControllerMappingJson from '../assets/controllers.json';

@Component({
    components: {
        Categories,
        Games,
    },
})
export default class Home extends Vue {
    protected gameList = new GameList();
    protected mame = new Mame();
    protected selectedCategory: GameCategory|null = null;
    protected selectedGameId: number = 0;
    protected selectedGame: Game|null = null;

    /** Gamepads **/
    protected gamepadCount: number = 0;
    protected animationFrameRequest: number|null = null;
    protected controllerMapping: {[key: string]: ControllerMapping} = ControllerMappingJson;
    protected gamepadKeyPressed:
        Array<{buttons: boolean[], axes: Array<{wasPressed: boolean, lastPressedKey: string|null}>}> = [];

    public mounted() {
        this.gameList = this.$store.getters.gameList;
        this.mame = this.$store.getters.mame;
        this.selectedCategory = this.gameList.getCategories()[0]; // Category ALL
        this.selectedGame = this.selectedCategory.getGames()[0];
        this.initGamepads();
    }

    /**
     * Called when categoryChange event is triggered on Categories component
     * @param categoryId
     */
    protected categoryChange(categoryId: number) {
        this.selectedCategory = this.gameList.getCategories()[categoryId];
    }

    /**
     * Called when gameChange event is triggered on Games component
     * @param gameId
     */
    protected gameChange(gameId: number) {
        this.selectedGameId = gameId;
        this.selectedGame = this.selectedCategory!.getGames()[gameId];
    }

    public initGamepads() {
        window.addEventListener('gamepadconnected', (e) => {
            this.gamepadCount++;
            if (this.gamepadCount === 1) {
                this.gamepadsButtons();
            }
        });

        window.addEventListener('gamepaddisconnected', (e) => {
            this.gamepadCount--;
            if (!this.gamepadCount) {
                if (this.animationFrameRequest) {
                    cancelAnimationFrame(this.animationFrameRequest);
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

            if (!this.gamepadKeyPressed[gamepadsKey]) {
                this.gamepadKeyPressed[gamepadsKey] = {axes: [], buttons: []};
            }

            const mapping = this.controllerMapping[gamepad.mapping || gamepad.id];
            if (!mapping) {
                continue;
            }

            // Joysticks
            gamepad.axes.forEach((value: number, index: number) => {
                let eventName: string|null = null;
                if (mapping.axes[index]) {
                    if (!this.gamepadKeyPressed[gamepadsKey].axes[index]) {
                        this.gamepadKeyPressed[gamepadsKey].axes[index] = {
                            wasPressed: false as boolean,
                            lastPressedKey: null as string|null,
                        };
                    }
                    const axe = this.gamepadKeyPressed[gamepadsKey].axes[index];
                    if (value !== 0 && !axe.wasPressed) {
                        eventName = 'gamepadKeydown';
                        axe.wasPressed = true;
                        axe.lastPressedKey = value > 0 ?
                            mapping.axes[index][1] : mapping.axes[index][0];
                    } else if (value === 0 && axe.wasPressed) {
                        eventName = 'gamepadKeyup';
                        axe.wasPressed = false;
                    }

                    if (eventName) {
                        const event = new CustomEvent(eventName, {
                            detail: {
                                key: axe.lastPressedKey,
                                value,
                            },
                        });
                        window.dispatchEvent(event);
                    }
                }
            });

            gamepad.buttons.forEach((button: GamepadButton, index: number) => {
                let eventName: string|null = null;
                if (mapping.buttons[index]) {
                    if (button.pressed) {
                        eventName = 'gamepadKeydown';
                        this.gamepadKeyPressed[gamepadsKey].buttons[index] = true;
                    } else if (this.gamepadKeyPressed[gamepadsKey].buttons[index]) {
                        eventName = 'gamepadKeyup';
                        this.gamepadKeyPressed[gamepadsKey].buttons[index] = false;
                    }

                    if (eventName) {
                        const event = new CustomEvent(eventName, {
                            detail: {
                                key: mapping.buttons[index],
                                value: button.value,
                            },
                        });
                        window.dispatchEvent(event);
                    }
                }
            });
        }

        this.animationFrameRequest = requestAnimationFrame(this.gamepadsButtons.bind(this));
    }
}
</script>

<style scoped>
    .gameTitle {
        position: absolute;
        width: 100%;
        z-index: 2;
        text-align: center;
        background: linear-gradient(to bottom, rgb(35, 10, 0) -30%, rgba(0, 0, 0, 0.3) 70%, transparent 100%);
        color: #fff513;
        font-size: 45px;
        padding: 26px;
        line-height: 1.2;
        font-family: 'Arcade_I', sans-serif;
        perspective: 460px;
        perspective-origin: 50% 50%;
        text-shadow:
            0 0 30px rgba(237, 106, 10, 0.8),
            0 3px 0 rgb(255, 81, 0),
            0 5px 20px rgba(255, 81, 0, 0.5),
            0 6px 5px rgba(242, 0, 10, 0.7),
            0 12px 16px rgba(0, 0, 0, 1),
            6px 12px 9px rgba(0, 0, 0, 1);
        transform: rotateX(15deg) rotateY(0deg) rotateZ(0deg);
        filter: saturate(1.3);
    }
        .gameTitle small {
            font-size: .5em;
            color: #fff513;
            text-shadow:
                0 0 30px rgba(237, 106, 10, 0.8),
                0 2px 0 rgb(255, 81, 0),
                0 4px 20px rgba(255, 81, 0, 0.5),
                0 6px 3px rgba(242, 0, 10, 0.7),
                0 12px 16px rgba(0, 0, 0, 1),
                6px 12px 9px rgba(0, 0, 0, 1);
            transform: rotateX(15deg) rotateY(0deg) rotateZ(0deg);
        }
</style>
