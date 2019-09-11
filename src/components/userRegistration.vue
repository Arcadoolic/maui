<template>
    <div class="user-registration">
        <p>Please select a username. It will be used to extract and display your hiscores.</p>
        <div class="letters">
            <div class="first-letter" :class="{selected: selectedLetter === 0}">
                <span>{{username[0]}}</span>
            </div>
            <div class="second-letter" :class="{selected: selectedLetter === 1}">
                <span>{{username[1]}}</span>
            </div>
            <div class="third-letter" :class="{selected: selectedLetter === 2}">
                <span>{{username[2]}}</span>
            </div>
        </div>
        <button type="button">Save</button>
    </div>
</template>

<script lang="ts">
    import {Component} from "vue-property-decorator";
    import ControllableVue from "../ControllableVue";

    @Component
    export default class UserRegistration extends ControllableVue {
        protected username: {[key: number]: string} = {0: 'A', 1: 'A', 2: 'A'};
        protected selectedLetter: number = 0;

        public created() {
            this.onKeydown((e, isGamepad) => {
                const key = (isGamepad) ? (e as CustomEvent).detail.key : (e as KeyboardEvent).code;
                switch (key) {
                    case 'ArrowUp':
                        this.previousLetter();
                        break;
                    case 'ArrowDown':
                        this.nextLetter();
                        break;
                    case 'ArrowLeft':
                        this.previousSelectedLetter();
                        break;
                    case 'ArrowRight':
                        this.nextSelectedLetter();
                        break;
                    case 'Enter':
                        this.nextSelectedLetter(true);
                        break;
                }
            });

            this.onKeyup((e, isGamepad) => { });
        }

        protected nextLetter() {
            this.username[this.selectedLetter] = this.username[this.selectedLetter] === 'Z' ? 'A' :
                String.fromCharCode(this.username[this.selectedLetter].charCodeAt(0) + 1);
        }

        protected previousLetter() {
            this.username[this.selectedLetter] = this.username[this.selectedLetter] === 'A' ? 'Z' :
                String.fromCharCode(this.username[this.selectedLetter].charCodeAt(0) - 1);
        }

        protected nextSelectedLetter(isEnter: boolean = false) {
            if (this.selectedLetter === 2 && isEnter) {
                console.log(this.username[0] + this.username[1] + this.username[2])
            } else {
                this.selectedLetter = this.selectedLetter === 2 ? 0 : this.selectedLetter + 1;
            }

        }

        protected previousSelectedLetter() {
            this.selectedLetter = this.selectedLetter === 0 ? 2 : this.selectedLetter - 1;
        }

    }
</script>

<style scoped>
    .user-registration {
        position: absolute;
        background: red;
        width: 640px;
        height: 300px;
        top: 50%;
        left: 50%;
        margin-left: -320px;
        margin-top: -150px;
        padding: 10px;
    }
        .user-registration > p {
            display: block;
            width: 100%;
            font-size: 14px;
            text-align: center;
        }

        .letters {
            width: 40%;
            margin: 0 auto;
            border: 2px solid yellow;
            border-radius: 3px;
        }
            .letters > div {
                display: inline-block;
                width: 33.3333%;
            }
            .letters > div > span {
                text-align: center;
                font-size: 60px;
                display: block;
            }
            .letters > div.selected {
                color: blue;
            }
</style>
