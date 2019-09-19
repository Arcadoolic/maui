<template>
    <div class="modal-container">
        <div class="modal-background"></div>
        <div class="modal user-registration-success" v-if="success">User created</div>
        <div class="modal user-registration" v-else>
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
            <div class="error" v-if="error">Username already used</div>
            <div class="validate">
                Press
                <span class="arcadeButton yellow"></span>
                to validate
            </div>
            <div class="cancel">
                Press
                <span class="arcadeButton blue"></span>
                to cancel
            </div>
        </div>
    </div>
</template>

<script lang="ts">
    import {Component} from "vue-property-decorator";
    import ControllableVue from "../ControllableVue";
    import User from "@/model/User.model";
    import {ValidationError} from 'sequelize';

    @Component
    export default class UserRegistration extends ControllableVue {
        protected username: {[key: number]: string} = {0: 'A', 1: 'A', 2: 'A'};
        protected selectedLetter: number = 0;
        protected success: boolean = false;
        protected error: boolean = false;
        protected loading: boolean = false;

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
                    case 'Space':
                        this.$emit('quit');
                        break;
                }
            });

            this.onKeyup((e, isGamepad) => { });
        }

        protected nextLetter() {
            if (!this.loading) {
                this.username[this.selectedLetter] = this.username[this.selectedLetter] === 'Z' ? 'A' :
                    String.fromCharCode(this.username[this.selectedLetter].charCodeAt(0) + 1);
            }
        }

        protected previousLetter() {
            if (!this.loading) {
                this.username[this.selectedLetter] = this.username[this.selectedLetter] === 'A' ? 'Z' :
                    String.fromCharCode(this.username[this.selectedLetter].charCodeAt(0) - 1);
            }
        }

        protected nextSelectedLetter(isEnter: boolean = false) {
            if (!this.loading) {
                if (this.selectedLetter === 2 && isEnter) {
                    this.addUser();
                } else {
                    this.selectedLetter = this.selectedLetter === 2 ? 0 : this.selectedLetter + 1;
                }
            }

        }

        protected previousSelectedLetter() {
            if (!this.loading) {
                this.selectedLetter = this.selectedLetter === 0 ? 2 : this.selectedLetter - 1;
            }
        }

        protected addUser() {
            if (this.loading) {
                return;
            }
            this.error = false;
            this.loading = true;
            User.findOrCreate({where: {pseudo_3: this.usernameString}, defaults: {active: false}})
                .then(([user, created]) => {
                    if (created) {
                        this.success = true;
                    } else if (user) {
                        this.error = true;
                    }
                    this.loading = false;
                });
        }

        protected get usernameString() {
            return this.username[0] + this.username[1] + this.username[2]
        }

        protected beforeDestroy() {
            super.beforeDestroy();
        }
    }
</script>

<style scoped>
    .modal-container {
        position: absolute;
        top: 0;
        bottom: 0;
        display: block;
        width: 100%;
        height: 100%;
    }
    .modal-background {
        width: 100%;
        height: 100%;
        background: rgba(0, 0, 0, 0.6);
    }

    .modal {
        display: inline-block;
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
            border: 2px solid yellow;
            border-radius: 3px;
            margin: 20px auto;
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

        .error {
            margin-bottom: 20px;
            text-align: center;
        }

        .validate, .cancel {
            font-size: 1.5em;
            text-align: center;
            display: flex;
            align-items: center;
            justify-content: center;
            margin-bottom: 20px;
        }

        .cancel {
            font-size: 1em;
        }

        .arcadeButton {
            display: inline-block;
            width: 30px;
            height: 30px;
            content: ' ';
            border-radius: 50%;
            box-shadow: #a7a700 1px 1px;
            margin: 0 15px;
        }
            .arcadeButton.yellow {
                background-color: yellow;
                box-shadow: #a7a700 1px 1px;
            }
            .arcadeButton.blue {
                background-color: blue;
                box-shadow: darkblue 1px 1px;
            }
</style>
