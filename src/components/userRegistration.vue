<template>
    <modal>
        <div class="user-registration-success" v-if="success">User created</div>
        <div class="user-registration" v-else>
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
                <span class="arcadeButton">
                    <i class="fas fa-male"></i>
                </span>
                to validate
            </div>
            <div class="cancel">
                Press
                <span class="arcadeButton rectangle"></span>
                to cancel
            </div>
        </div>
    </modal>
</template>

<script lang="ts">
    import {Component} from "vue-property-decorator";
    import ControllableVue from "../ControllableVue";
    import User from "@/model/User.model";
    import {ValidationError} from 'sequelize';
    import Modal from "@/components/Modal.vue";

    @Component({
        components: {
            Modal
        }
    })
    export default class UserRegistration extends ControllableVue {
        protected username: {[key: number]: string} = {0: 'A', 1: 'A', 2: 'A'};
        protected selectedLetter: number = 0;
        protected success: boolean = false;
        protected error: boolean = false;
        protected loading: boolean = false;

        protected prisitine: boolean = true;

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
                    case 'KeyP':
                        this.addUser();
                        break;
                    case 'Space':
                        this.$emit('quit');
                        break;
                }
                this.prisitine = false;
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
                this.selectedLetter = this.selectedLetter === 2 ? 0 : this.selectedLetter + 1;
            }
        }

        protected previousSelectedLetter() {
            if (!this.loading) {
                this.selectedLetter = this.selectedLetter === 0 ? 2 : this.selectedLetter - 1;
            }
        }

        protected addUser() {
            if (this.loading || this.prisitine) {
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
        .user-registration > p {
            display: block;
            width: 100%;
            font-size: 14px;
            text-align: center;
            line-height: 20px;
        }

        .letters {
            width: 40%;
            border-radius: 3px;
            margin: 20px auto;
            color: #fff513;
            filter: saturate(1.3);
            text-shadow: 0 0 30px rgba(237, 106, 10, 0.8), 0 3px 0 rgb(255, 81, 0);
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
                text-shadow: 0 0 30px rgba(237, 106, 10, 0.8),
                0 3px 0 rgb(255, 81, 0),
                0 5px 20px rgba(255, 81, 0, 0.5),
                0 6px 5px rgba(242, 0, 10, 0.7),
                0 12px 16px rgba(0, 0, 0, 1),
                6px 12px 9px rgba(0, 0, 0, 1);
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
            background-color: snow;
            color: black;
            line-height: 30px;
            text-align: center;
            font-size: 20px;
        }
            .arcadeButton.rectangle {
                border-radius: 0;
                width: 50px;
            }
</style>
