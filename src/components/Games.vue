<template>
    <div class="gamesContainer">
        <div class="selectedGameBackground"></div>
        <div class="games">
            <ul ref="gameList">
                <li v-for="(game, index) in games" :class="{selected: selectedGameIndex === index}">
                    <div class="marquee"
                         :style="{
                            marginLeft: Math.max(9 - Math.abs(selectedGameIndex - index), 0) + '%',
                            backgroundImage: getMarquee(game.romName)
                        }"
                    ></div>
                </li>
            </ul>
            <!--            <ul ref='gameList' :style='{transition: 'top ' + transitionTime + 's ease'}'>-->
            <!--                <transition v-for='(game, index) in selectedCategory.getGames()' :key='index'-->
            <!--                            @before-enter='gamesAnimationBeforeEnter'-->
            <!--                            @enter='gamesAnimationEnter'-->
            <!--                            @leave='gameLeaveAnimation'-->
            <!--                >-->
            <!--                    <li  :class='{selected: selectedGameId === index}' v-if='showGames'>-->
            <!--                        <div class='marquee' :style='marqueeStyle(game, index)'>-->
            <!--                            <Champions v-if='game.hasHiscore' :game='game'></Champions>-->
            <!--                        </div>-->
            <!--                        <img :src='game.flyer' style='display: none' v-if='game.flyer.length'> &lt;!&ndash; To cache flyers without displaying them &ndash;&gt;-->
            <!--                    </li>-->
            <!--                </transition>-->
            <!--            </ul>-->
        </div>

        <!--        <div class='flyer-container'>-->
        <!--            <transition @before-enter='flyerAnimationBeforeEnter' @enter='flyerAnimationEnter' @leave='flyerAnimationLeave'>-->
        <!--                <div class='flyer' v-if='showFlyer-->
        <!--                    && selectedCategory.getGames()[selectedGameId] && selectedCategory.getGames()[selectedGameId].flyer'-->
        <!--                    :style='{backgroundImage: this.flyerImage.length ? 'url(' + this.flyerImage + ')' : false}'></div>-->
        <!--            </transition>-->
        <!--        </div>-->
    </div>
</template>

<script lang='ts'>
    import {Component, Prop, Watch, Model} from 'vue-property-decorator';
    import ControllableVue from '@/ControllableVue';
    import Velocity from 'velocity-animate';
    import Champions from '@/components/Champions.vue';
    import Game from '@/model/Game.model';
    import {join} from 'path';
    import {format} from 'url';

    @Component({
        components: {Champions},
    })
    export default class Games extends ControllableVue {
        @Prop({required: true})
        protected readonly games!: Game[];

        @Prop({required: true, type: Number, default: 0})
        protected readonly selectedGameIndex!: number;

        protected marqueesPath: string = '';
        protected marquees: string[] = [];

        // @Prop({required: true, type: GameCategory}) protected selectedCategory!: GameCategory;
        @Prop({type: Boolean, default: true}) protected focused!: boolean;

        public created() {
            const mameService = this.$store.getters.mameService;
            const gameService = this.$store.getters.gameService;

            this.marqueesPath = mameService.marqueePath;
            this.marquees = gameService.loadMarquees();
        }

        @Watch('selectedGameIndex')
        protected updateGamesPosition(val: number, prevValue: number) {
            if (this.$refs.gameList) {
                (this.$refs.gameList as HTMLElement).style.top = (-10 * val) + '%';
            }
        }

        protected getMarquee(romName: string) {
            const i = this.marquees.indexOf(romName + '.png');
            const path = i < 0 ? null : join(this.marqueesPath, this.marquees[i]);
            if (!path) {
                return '';
            }
            console.log(path);
            return 'url(' + format({
                pathname: path,
                protocol: 'file',
                slashes: true,
            })  + ')';
        }

        /***
         * ANIMTATIONS AND STYLES
         ***/

        // public gamesAnimationBeforeEnter(el: HTMLElement) {
        //     el.style.marginLeft = '-100%';
        // }
        //
        // public gamesAnimationEnter(el: HTMLElement, done: () => void) {
        //     Velocity(el, {marginLeft: 0}, {
        //         duration: Math.random() * (400 - 600) + 400,
        //         easing: 'ease-in',
        //         complete: done,
        //     });
        // }
        //
        // public gameLeaveAnimation(el: HTMLElement, done: () => void) {
        //     setTimeout(() => {
        //         Velocity(el, {marginLeft: el.classList.contains('selected') ? '-200%' : '-100%'}, {
        //             duration: 400,
        //             easing: 'ease',
        //             complete: done,
        //         });
        //     }, Math.random() * (100 - 300) + 100);
        // }
        //
        // public flyerAnimationBeforeEnter(el: HTMLElement) {
        //     el.style.marginLeft = '100%';
        // }
        //
        // public flyerAnimationEnter(el: HTMLElement, done: () => void) {
        //     Velocity(el, {marginLeft: 0}, {
        //         duration: 300,
        //         easing: 'ease-out',
        //         complete: done,
        //     });
        // }
        //
        // public flyerAnimationLeave(el: HTMLElement, done: () => void) {
        //     Velocity(el, {marginLeft: '100%'}, {
        //         duration: 300,
        //         easing: 'ease-out',
        //         complete: done,
        //     });
        // }
        //
        // protected getGameAnimationSpeed(previousSpeed: number, incrementer: number) {
        //     let newSpeed = previousSpeed - Math.pow(1.5, incrementer);
        //     if (newSpeed < 200) {
        //         newSpeed = 200;
        //     }
        //     return newSpeed;
        // }
        //
        // protected animateFlyers() {
        //     this.showFlyer = false;
        //     clearTimeout(this.timeouts.showFlyer);
        //     this.timeouts.showFlyer = setTimeout(() => {
        //         if (this.selectedCategory.getGames()[this.selectedGameId]) {
        //             this.flyerImage = this.selectedCategory.getGames()[this.selectedGameId].flyer;
        //             this.showFlyer = true;
        //         }
        //     }, 300);
        // }
        //
        // protected animateGames() {
        //     return new Promise((resolve, reject) => {
        //         this.showGames = false;
        //         clearTimeout(this.timeouts.showGames);
        //         this.timeouts.showGames = setTimeout(() => {
        //             this.showGames = true;
        //             resolve();
        //         }, 300);
        //     });
        // }

        /**
         * Called on move up
         */
        // protected moveUp(speed: number, incrementer = 1) {
        //     if (!this.focused) {
        //         return () => {
        //             return;
        //         };
        //     }
        //     const newSpeed = this.getGameAnimationSpeed(speed, incrementer);
        //     incrementer += 1;
        //     this.showFlyer = false;
        //     if (speed > 250) {
        //         this.animateFlyers();
        //     }
        //     this.transitionTime = speed / 1000;
        //     return () => {
        //         this.selectedGameId = this.selectedGameId <= 0 ?
        //             this.selectedCategory.getGames().length - 1 : this.selectedGameId - 1;
        //         this.updateGamesPosition();
        //         this.emitGameChange();
        //         this.timeouts.moveUp = setTimeout(this.moveUp(newSpeed, incrementer), newSpeed);
        //         return;
        //     };
        // }

        /**
         * Called on move down
         */
        // protected moveDown(speed: number, incrementer = 1) {
        //     if (!this.focused) {
        //         return () => {
        //             return;
        //         };
        //     }
        //     const newSpeed = this.getGameAnimationSpeed(speed, incrementer);
        //     incrementer += 1;
        //     this.showFlyer = false;
        //     if (speed > 250) {
        //         this.animateFlyers();
        //     } else {
        //         this.showFlyer = false;
        //     }
        //     this.transitionTime = speed / 1000;
        //     return () => {
        //         this.selectedGameId = this.selectedGameId >= this.selectedCategory.getGames().length - 1 ?
        //             0 : this.selectedGameId + 1;
        //         this.updateGamesPosition();
        //         this.emitGameChange();
        //         this.timeouts.moveDown = setTimeout(this.moveDown(newSpeed, incrementer), newSpeed);
        //         return;
        //     };
        // }

        /**
         * Start a game
         */
        // protected async startGame() {
        //     if (!this.focused) {
        //         return;
        //     }
        //     const selectedGame = this.selectedCategory.getGames()[this.selectedGameId];
        //     const db = this.$store.getters.db;
        //
        //     const mameProcess = await this.mame.start(selectedGame);
        //     if (!mameProcess) {
        //         console.error('Failed start rom ' + selectedGame.romName);
        //         return;
        //     }
        //
        //     // Log game start
        //     await db.connect();
        //     await db.logGameStart(selectedGame.romName);
        //     db.end();
        //
        //     mameProcess.on('close', async () => {
        //         try {
        //             await db.connect();
        //             const hiscores: HiscoresJson = {
        //                 season: selectedGame.hiscores.season,
        //                 allTime: selectedGame.hiscores.allTime
        //             };
        //             hiscores.season = await this.hiscores.getHiscore(selectedGame.romName);
        //             if (selectedGame.hiscores.season.classic[0]) {
        //                 await db.saveHiscores(selectedGame.romName, selectedGame.hiscores.season.classic[0]);
        //             }
        //             hiscores.allTime = await db.getAllTime(selectedGame.romName);
        //             await this.hiscores.saveHiscore(selectedGame.romName, selectedGame.hiscores);
        //             db.end();
        //             selectedGame.hiscores = hiscores;
        //         } catch (e) {
        //             this.$store.getters.logger.logError('[' + selectedGame.romName + ']' + e);
        //             return;
        //         }
        //     });
        // }
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
        transition: top 0.3s ease
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
        transition: height 0.3s ease, width 0.3s ease, margin-left 0.3s ease, margin-left 0.3s ease
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
