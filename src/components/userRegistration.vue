<template>
    <modal>
        <div class="user-registration-success" v-if="success">Player created</div>
        <div class="user-registration" v-else>
            <p>Please select a player name. It will be used to extract and display your hiscores.</p>
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
            <div class="error" v-if="error">Player name already used</div>
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

<script setup lang="ts">
import {ref, computed} from 'vue';
import {useControllable} from '@/composables/useControllable';
import {MAUI_KEYS} from '@/class/MauiControls';
import {getUserService} from '@/services';
import Modal from '@/components/Modal.vue';

const emit = defineEmits<{quit: []}>();

const username = ref<{[key: number]: string}>({0: 'A', 1: 'A', 2: 'A'});
const selectedLetter = ref(0);
const success = ref(false);
const error = ref(false);
const loading = ref(false);
const pristine = ref(true);

const usernameString = computed(() => username.value[0] + username.value[1] + username.value[2]);

function nextLetter() {
    if (!loading.value) {
        username.value[selectedLetter.value] = username.value[selectedLetter.value] === 'Z' ? 'A' :
            String.fromCharCode(username.value[selectedLetter.value].charCodeAt(0) + 1);
    }
}

function previousLetter() {
    if (!loading.value) {
        username.value[selectedLetter.value] = username.value[selectedLetter.value] === 'A' ? 'Z' :
            String.fromCharCode(username.value[selectedLetter.value].charCodeAt(0) - 1);
    }
}

function nextSelectedLetter() {
    if (!loading.value) {
        selectedLetter.value = selectedLetter.value === 2 ? 0 : selectedLetter.value + 1;
    }
}

function previousSelectedLetter() {
    if (!loading.value) {
        selectedLetter.value = selectedLetter.value === 0 ? 2 : selectedLetter.value - 1;
    }
}

function addUser() {
    if (loading.value || pristine.value) {
        return;
    }
    error.value = false;
    loading.value = true;
    getUserService().registerUser(usernameString.value)
        .then(({created}) => {
            if (created) {
                success.value = true;
            } else {
                error.value = true;
            }
            loading.value = false;
        });
}

const {onKeydown, onKeyup} = useControllable();

onKeydown((e, isGamepad) => {
    const key = isGamepad ? (e as CustomEvent).detail.key : (e as KeyboardEvent).code;
    switch (key) {
    case MAUI_KEYS.up:
        previousLetter();
        break;
    case MAUI_KEYS.down:
        nextLetter();
        break;
    case MAUI_KEYS.left:
        previousSelectedLetter();
        break;
    case MAUI_KEYS.right:
        nextSelectedLetter();
        break;
    case MAUI_KEYS.p:
        addUser();
        break;
    case MAUI_KEYS.space:
        emit('quit');
        break;
    }
    pristine.value = false;
});

onKeyup(() => {
    // No-op: keyup is handled by the keydown listener above.
});
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
