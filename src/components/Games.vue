<template>
    <div class="gamesContainer">
        <div class="selectedGameBackground"></div>
        <div class="games">
            <ul ref="gameList" :style="{transition: 'top ' + transitionTime + 's ease'}">
                <li v-for="(game, index) in selectedCategory.getGames()" :class="{selected: selectedGameId === index}">
                    <div class="marquee"
                         :style="{
                            transition: marqueeTransition,
                            marginLeft: Math.max(9 - Math.abs(selectedGameId - index), 0) + '%',
                            backgroundImage: game.marquee ? 'url('+game.marquee+')' : false
                        }"
                    ></div>
                </li>
            </ul>
        </div>
    </div>
</template>

<script lang="ts">
import {Vue, Component, Prop, Watch} from 'vue-property-decorator';
import GameList from '@/class/GameList.class';
import Mame from '@/class/Mame.class';
import GameCategory from '@/class/GameCategory.class';
import {ChildProcess} from 'child_process';
import HiScore from '@/class/HiScore.class';
import ControllableVue from '@/ControllableVue.vue';

@Component
export default class Games extends ControllableVue {
    protected gameList = new GameList();
    protected mame = new Mame();

    protected selectedGameId = 0;

    protected moveUpTimeout: any = 0;
    protected moveDownTimeout: any = 0;

    protected transitionTime = 0.3;

    @Prop({required: true, type: GameCategory}) protected selectedCategory!: GameCategory;

    public created() {
        /** Init vars */
        this.gameList = this.$store.getters.gameList;
        this.mame = this.$store.getters.mame;

        this.onKeydown((e: Event, isGamepad: boolean) => {
            const key = (isGamepad) ? (e as CustomEvent).detail.key : (e as KeyboardEvent).key;
            switch (key) {
                case 'ArrowUp':
                    this.transitionTime = 0.5;
                    this.moveUp(500)();
                    break;
                case 'ArrowDown':
                    this.transitionTime = 0.5;
                    this.moveDown(500)();
                    break;
                case 'Enter':
                    this.startGame();
                    break;

            }
        });

        this.onKeyup((e: Event, isGamepad: boolean) => {
            const key = (isGamepad) ? (e as CustomEvent).detail.key : (e as KeyboardEvent).key;
            switch (key) {
                case 'ArrowUp':
                    clearTimeout(this.moveUpTimeout);
                    this.moveUpTimeout = 0;
                    break;
                case 'ArrowDown':
                    clearTimeout(this.moveDownTimeout);
                    this.moveDownTimeout = 0;
                    break;
            }
        });
    }

    /**
     * Called on move up
     */
    protected moveUp(speed: number, incrementer = 1) {
        let newSpeed = speed;
        newSpeed = speed - Math.pow(1.5, incrementer);
        incrementer += 1;
        if (newSpeed < 200) {
            newSpeed = 200;
        }
        this.transitionTime = speed / 1000;
        return () => {
            this.selectedGameId = this.selectedGameId <= 0 ?
                this.selectedCategory.getGames().length - 1 : this.selectedGameId - 1;
            this.updateGamesPosition();
            this.emitGameChange();
            this.moveUpTimeout = setTimeout(this.moveUp(newSpeed, incrementer), newSpeed);
            return;
        };
    }


    /**
     * Called on move down
     */
    protected moveDown(speed: number, incrementer = 1) {
        let newSpeed = speed;
        newSpeed = speed - Math.pow(1.5, incrementer);
        incrementer += 1;
        if (newSpeed < 200) {
            newSpeed = 200;
        }
        this.transitionTime = speed / 1000;
        return () => {
            this.selectedGameId = this.selectedGameId >= this.selectedCategory.getGames().length - 1 ?
                0 : this.selectedGameId + 1;
            this.updateGamesPosition();
            this.emitGameChange();
            this.moveDownTimeout = setTimeout(this.moveDown(newSpeed, incrementer), speed);
        };
    }

    /**
     * Start a game
     */
    protected startGame() {
        const selectedGame = this.selectedCategory.getGames()[this.selectedGameId];
        this.mame.start(selectedGame).then(
            (process: ChildProcess|void) => {
                if (process) {
                    process.on('close', (e) => {
                        if (selectedGame.hasHiscore) {
                            (new HiScore()).getHiscore(selectedGame.romName).then(
                                (hiscore: any) => {
                                    console.log(hiscore);
                                },
                            );
                        }
                    });
                }
            },
        );
    }

    /**
     * Calculate game list top position
     */
    protected updateGamesPosition() {
        if (this.$refs.gameList) {
            (this.$refs.gameList as HTMLElement).style.top = (-10 * this.selectedGameId) + '%';
        }
    }

    /**
     * If selectedCategories change, reset current game to 0 and emit event
     */
    @Watch('selectedCategory')
    protected watchSelectedCategory(val: GameCategory, oldVal: GameCategory) {
        console.log('Hello');
        this.selectedGameId = 0;
        this.emitGameChange();
        this.updateGamesPosition();
    }

    /**
     * Emit event to parent when the selected game change
     */
    protected emitGameChange() {
        this.$emit('gameChange', this.selectedGameId);
    }

    protected get marqueeTransition() {
        return 'height ' + this.transitionTime + 's ease, width ' + this.transitionTime + 's ease, margin-left '
            + this.transitionTime + 's ease'
    }
}
</script>

<style scoped>
    .gamesContainer {
        width: 100%;
        height: 100%;
        overflow: hidden;
        position: relative;
        /*z-index: 12;*/
        filter: saturate(2);
    }

    .selectedGameBackground {
        position: absolute;
        left: 0;
        top: 35%;
        background: linear-gradient(to right, rgba(0, 30, 255, 0.25) 50%, transparent);
        height: 30%;
        width: 50%;
    }

    .games {
        position: relative;
        top: 35%;
        height: 65%;
        /*border: 1px solid red;*/
        width: 50%;
    }

    .games ul {
        position: absolute;
        top: 0;
        right: 0;
        left: 0;
        width: 100%;
        height: 100%;
        /*border: 1px solid yellow;*/
        overflow: visible;
        /*transition: top 0.3s ease;*/
    }

    .games ul li {
        display: flex;
        height: 10%;
        width: 100%;
        /*border: 1px solid green;*/
        position: relative;
        align-items: center;
    }

    .games ul li.selected {
        height: 46%;
        top: 0;
    }

    .games .marquee {
        margin-left: 10%;
        display: inline-block;
        width: 35%;
        height: 90%;
        background-repeat: no-repeat;
        background-image: url(../assets/default_marquee.jpg);
        background-size: cover;
        background-position: center;
        border-radius: 5px;
        box-shadow: 0 0 30px #000000;
        /*transition: height 0.3s ease, width 0.3s ease, margin-left 0.3s ease;*/
    }

    .games ul li.selected .marquee {
        width: 100%;
        height: 80%;
    }
</style>
