<template>
    <div class="gamesContainer">
        <div class="selectedGameBackground"></div>
        <div class="games">
            <ul ref="gameList" :style="{transition: 'top ' + transitionTime + 's ease'}">
                <transition v-for="(game, index) in selectedCategory.getGames()" :key="index"
                            @before-enter="gamesAnimationBeforeEnter"
                            @enter="gamesAnimationEnter"
                            @leave="gameLeaveAnimation"
                >
                    <li  :class="{selected: selectedGameId === index}" v-if="showGames">
                        <div class="marquee" :style="marqueeStyle(game, index)">
                            <Champions v-if="game.hasHiscore" :game="game"></Champions>
                        </div>
                        <img :src="game.flyer" style="display: none" v-if="game.flyer.length"> <!-- To cache flyers without displaying them -->
                    </li>
                </transition>
            </ul>
        </div>

        <div class="flyer-container">
            <transition @before-enter="flyerAnimationBeforeEnter" @enter="flyerAnimationEnter" @leave="flyerAnimationLeave">
                <div class="flyer" v-if="showFlyer
                    && selectedCategory.getGames()[selectedGameId] && selectedCategory.getGames()[selectedGameId].flyer"
                    :style="{backgroundImage: this.flyerImage.length ? 'url(' + this.flyerImage + ')' : false}"></div>
            </transition>
        </div>
    </div>
</template>

<script lang="ts">
import {Component, Prop, Watch} from 'vue-property-decorator';
import GameList from '@/class/GameList.class';
import Mame from '@/class/Mame.class';
import GameCategory from '@/class/GameCategory.class';
import {ChildProcess} from 'child_process';
import HiscoreService from '@/class/HiscoreService.class';
import ControllableVue from '@/ControllableVue.vue';
import Game from '@/class/Game.class';
import Velocity from 'velocity-animate';
import Gamepads from '@/class/Gamepads.class';
import Champions from '@/components/Champions.vue';
import {appendFileSync} from 'fs';

@Component({
    components: {Champions},
})
export default class Games extends ControllableVue {
    protected timeouts: {[key: string]: any} = {
        moveUp: 0 as any,
        moveDown: 0 as any,
        showFlyer: 0 as any,
    };

    protected gameList = new GameList();
    protected mame = new Mame();
    protected hiscores!: HiscoreService;

    protected selectedGameId = 0;

    protected transitionTime = 0.3;

    protected showGames = false;
    protected showFlyer = true;

    protected flyerImage: string|null = null;

    @Prop({required: true, type: GameCategory}) protected selectedCategory!: GameCategory;
    @Prop({type: Boolean, default: true}) protected focused!: boolean;

    public created() {
        /** Init vars */
        this.gameList = this.$store.getters.gameList;
        this.mame = this.$store.getters.mame;
        this.hiscores = this.$store.getters.hiscore;

        this.flyerImage = this.selectedCategory.getGames()[0].flyer;

        this.onKeydown((e: Event, isGamepad: boolean) => {
            const key = (isGamepad) ? (e as CustomEvent).detail.key : (e as KeyboardEvent).code;
            console.log(key);
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
            const key = (isGamepad) ? (e as CustomEvent).detail.key : (e as KeyboardEvent).code;
            switch (key) {
                case 'ArrowUp':
                    clearTimeout(this.timeouts.moveUp);
                    this.timeouts.moveUp = 0;
                    this.animateFlyers();
                    break;
                case 'ArrowDown':
                    clearTimeout(this.timeouts.moveDown);
                    this.timeouts.moveDown = 0;
                    this.animateFlyers();
                    break;
            }
        });
    }

    public mounted() {
        this.showGames = true;
    }

    /***
     * ANIMTATIONS AND STYLES
     ***/

    public gamesAnimationBeforeEnter(el: HTMLElement) {
        el.style.marginLeft = '-100%';
    }

    public gamesAnimationEnter(el: HTMLElement, done: () => void) {
        Velocity(el, {marginLeft: 0}, {
            duration: Math.random() * (400 - 600) + 400,
            easing: 'ease-in',
            complete: done,
        });
    }

    public gameLeaveAnimation(el: HTMLElement, done: () => void) {
        setTimeout(() => {
            Velocity(el, {marginLeft: el.classList.contains('selected') ? '-200%' : '-100%'}, {
                duration: 400,
                easing: 'ease',
                complete: done,
            });
        }, Math.random() * (100 - 300) + 100);
    }

    public flyerAnimationBeforeEnter(el: HTMLElement) {
        el.style.marginLeft = '100%';
    }

    public flyerAnimationEnter(el: HTMLElement, done: () => void) {
        Velocity(el, {marginLeft: 0}, {
            duration: 300,
            easing: 'ease-out',
            complete: done,
        });
    }

    public flyerAnimationLeave(el: HTMLElement, done: () => void) {
        Velocity(el, {marginLeft: '100%'}, {
            duration: 300,
            easing: 'ease-out',
            complete: done,
        });
    }

    protected get marqueeTransition() {
        return 'height ' + this.transitionTime + 's ease, width ' + this.transitionTime + 's ease, margin-left '
            + this.transitionTime + 's ease, margin-left 0.3s ease';
    }

    protected get marqueeStyle() {
        return (game: Game, index: number) => {
            return {
                transition: this.marqueeTransition,
                marginLeft: Math.max(9 - Math.abs(this.selectedGameId - index), 0) + '%',
                backgroundImage: game.marquee ? 'url( ' + game.marquee + ')' : '',
            };
        };
    }

    protected getGameAnimationSpeed(previousSpeed: number, incrementer: number) {
        let newSpeed = previousSpeed - Math.pow(1.5, incrementer);
        if (newSpeed < 200) {
            newSpeed = 200;
        }
        return newSpeed;
    }

    protected animateFlyers() {
        this.showFlyer = false;
        clearTimeout(this.timeouts.showFlyer);
        this.timeouts.showFlyer = setTimeout(() => {
            if (this.selectedCategory.getGames()[this.selectedGameId]) {
                this.flyerImage = this.selectedCategory.getGames()[this.selectedGameId].flyer;
                this.showFlyer = true;
            }
        }, 300);
    }

    protected animateGames() {
        return new Promise((resolve, reject) => {
            this.showGames = false;
            clearTimeout(this.timeouts.showGames);
            this.timeouts.showGames = setTimeout(() => {
                this.showGames = true;
                resolve();
            }, 300);
        });
    }

    /**
     * Called on move up
     */
    protected moveUp(speed: number, incrementer = 1) {
        if (!this.focused) {
            return () => { return; };
        }
        const newSpeed = this.getGameAnimationSpeed(speed, incrementer);
        incrementer += 1;
        this.showFlyer = false;
        if (speed > 250) {
            this.animateFlyers();
        }
        this.transitionTime = speed / 1000;
        return () => {
            this.selectedGameId = this.selectedGameId <= 0 ?
                this.selectedCategory.getGames().length - 1 : this.selectedGameId - 1;
            this.updateGamesPosition();
            this.emitGameChange();
            this.timeouts.moveUp = setTimeout(this.moveUp(newSpeed, incrementer), newSpeed);
            return;
        };
    }

    /**
     * Called on move down
     */
    protected moveDown(speed: number, incrementer = 1) {
        if (!this.focused) {
            return () => { return; };
        }
        const newSpeed = this.getGameAnimationSpeed(speed, incrementer);
        incrementer += 1;
        this.showFlyer = false;
        if (speed > 250) {
            this.animateFlyers();
        } else {
            this.showFlyer = false;
        }
        this.transitionTime = speed / 1000;
        return () => {
            this.selectedGameId = this.selectedGameId >= this.selectedCategory.getGames().length - 1 ?
                0 : this.selectedGameId + 1;
            this.updateGamesPosition();
            this.emitGameChange();
            this.timeouts.moveDown = setTimeout(this.moveDown(newSpeed, incrementer), newSpeed);
            return;
        };
    }

    /**
     * Start a game
     */
    protected async startGame() {
        if (!this.focused) {
            return;
        }
        const selectedGame = this.selectedCategory.getGames()[this.selectedGameId];
        const db = this.$store.getters.db;

        const mameProcess = await this.mame.start(selectedGame);
        if (!mameProcess) {
            console.error('Failed start rom ' + selectedGame.romName);
            return;
        }

        // Log game start
        await db.connect();
        await db.logGameStart(selectedGame.romName);
        db.end();

        mameProcess.on('close', async () => {
            try {
                await db.connect();
                selectedGame.hiscores.season = await this.hiscores.getHiscore(selectedGame.romName);
                if (selectedGame.hiscores.season.classic[0]) {
                    await db.saveHiscores(selectedGame.romName, selectedGame.hiscores.season.classic[0]);
                }
                selectedGame.hiscores.allTime = await db.getAllTime(selectedGame.romName);
                await this.hiscores.saveHiscore(selectedGame.romName, selectedGame.hiscores);
                db.end();
            } catch (e) {
                this.$store.getters.logger.logError('[' + selectedGame.romName + ']' + e);
                return;
            }
        });
    }

    /**
     * Calculate game list top position
     */
    protected updateGamesPosition(transition: boolean = true) {
        if (this.$refs.gameList) {
            (this.$refs.gameList as HTMLElement).style.top = (-10 * this.selectedGameId) + '%';
        }
    }

    /**
     * If selectedCategories change, reset current game to 0 and emit event
     */
    @Watch('selectedCategory')
    protected watchSelectedCategory() {
        this.animateFlyers();
        this.animateGames().then(() => {
            this.selectedGameId = 0;
            this.emitGameChange();
            this.updateGamesPosition();
        });
    }

    /**
     * Emit event to parent when the selected game change
     */
    protected emitGameChange() {
        this.$emit('gameChange', this.selectedGameId);
    }
}
</script>

<style scoped>
    .gamesContainer {
        width: 100%;
        height: 100%;
        overflow: hidden;
        position: relative;
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
        width: 50%;
    }

    .games ul {
        position: absolute;
        top: 0;
        right: 0;
        left: 0;
        width: 100%;
        height: 100%;
        overflow: visible;
    }

    .games ul li {
        display: flex;
        height: 10%;
        width: 100%;
        position: relative;
        align-items: center;
    }

    .games ul li.selected {
        height: 46%;
        top: 0;
    }

    .games .marquee {
        /*margin-left: 10%;*/
        display: inline-block;
        width: 35%;
        height: 90%;
        background-repeat: no-repeat;
        background-image: url(../assets/default_marquee.jpg);
        background-size: cover;
        background-position: center;
        border-radius: 5px;
        box-shadow: 0 0 30px #000000;
        margin-left: -100%;
        position: relative;
    }

    .games ul li.selected .marquee {
        width: 100%;
        height: 80%;
    }

    .flyer-container {
        position: absolute;
        right: -3%;
        top: -5%;
        bottom: -5%;
        width: 40%;
    }
        .flyer {
            width: 100%;
            height: 100%;
            transform: rotateZ(-4deg);
            background-repeat: no-repeat;
            background-size: cover;
        }


    .champions {
        position: absolute;
        right: -10%;
        height: 100%;
        width: 100%;
        /*transition: all 0.3s;*/
    }
</style>
