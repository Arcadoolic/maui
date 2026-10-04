<template>
    <modal>
        <div class="user-registration-success" v-if="step === 'success'">{{successMessage}}</div>
        <div class="user-registration" v-else-if="step === 'pin_shown'">
            <p>Player <strong>{{usernameString}}</strong> created. Their PIN:</p>
            <div class="letters pin">
                <div v-for="(digit, index) in shownPin" :key="index"><span>{{digit}}</span></div>
            </div>
            <p>Write it down: it is needed to play as {{usernameString}} on another cabinet.
                If lost, a MAUI-API administrator can find it.</p>
            <div class="validate">
                Press
                <span class="arcadeButton">
                    <i class="fas fa-male"></i>
                </span>
                when done
            </div>
        </div>
        <div class="user-registration" v-else-if="step === 'pin'">
            <p v-if="returning">{{usernameString}} was removed from this cabinet. Enter their PIN to play with them here again.</p>
            <p v-else>{{usernameString}} already plays on another cabinet. Enter their PIN to play with them here.</p>
            <div class="letters pin">
                <div v-for="(digit, index) in pin" :key="index" :class="{selected: selectedDigit === index}">
                    <span>{{digit}}</span>
                </div>
            </div>
            <div class="error" v-if="errorMessage">{{errorMessage}}</div>
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
            <div class="error" v-if="errorMessage">{{errorMessage}}</div>
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
    import {createOnlineClient} from '@/class/OnlineClient';
    import {linkWithPin, registerOnline, type RegistrationOutcome} from '@/class/OnlineRegistration';
    import {newPseudo3Error} from '@/class/Pseudo3';
    import type {OnlinePlayer} from '@/class/MauiApiClient';
    import Modal from '@/components/Modal.vue';

    // In ONLINE mode the initials are reserved in MAUI-API first (OnlineRegistration.ts): free ones
    // show the new player's PIN once, taken ones ask for that player's PIN to link them here.
    type Step = 'letters' | 'pin' | 'pin_shown' | 'success';

    const emit = defineEmits<{quit: []}>();

    const username = ref<{[key: number]: string}>({0: 'A', 1: 'A', 2: 'A'});
    const selectedLetter = ref(0);
    const step = ref<Step>('letters');
    const successMessage = ref('Player created');
    const errorMessage = ref('');
    const loading = ref(false);
    const pristine = ref(true);
    const pin = ref([0, 0, 0, 0]);
    const selectedDigit = ref(0);
    const shownPin = ref('');
    // The PIN is asked for a player deleted from this cabinet, not for one of another cabinet.
    const returning = ref(false);

    const usernameString = computed(() => username.value[0] + username.value[1] + username.value[2]);

    function cycle(value: number, delta: number, size: number): number {
        return (value + delta + size) % size;
    }

    function changeCharacter(delta: number) {
        if (loading.value) {
            return;
        }
        if (step.value === 'pin') {
            pin.value[selectedDigit.value] = cycle(pin.value[selectedDigit.value], delta, 10);
        } else if (step.value === 'letters') {
            const code = username.value[selectedLetter.value].charCodeAt(0) - 65;
            username.value[selectedLetter.value] = String.fromCharCode(65 + cycle(code, delta, 26));
        }
    }

    function moveSelection(delta: number) {
        if (loading.value) {
            return;
        }
        if (step.value === 'pin') {
            selectedDigit.value = cycle(selectedDigit.value, delta, 4);
        } else if (step.value === 'letters') {
            selectedLetter.value = cycle(selectedLetter.value, delta, 3);
        }
    }

    async function saveOnlineUser(player: OnlinePlayer) {
        const saved = await getUserService().saveOnlineUser(player);
        if (saved.reserved) {
            throw new Error('Player name reserved on this cabinet: ask its administrator.');
        }
        return saved;
    }

    function apply(outcome: RegistrationOutcome) {
        switch (outcome.kind) {
        case 'created':
            shownPin.value = outcome.pin;
            step.value = 'pin_shown';
            break;
        case 'pin_required':
            pin.value = [0, 0, 0, 0];
            selectedDigit.value = 0;
            step.value = 'pin';
            break;
        case 'linked':
            successMessage.value = `${usernameString.value} can now play on this cabinet`;
            step.value = 'success';
            break;
        case 'error':
            errorMessage.value = outcome.message;
            break;
        }
    }

    async function addUser() {
        const userService = getUserService();
        const pseudo3Error = newPseudo3Error(usernameString.value);
        if (pseudo3Error) {
            errorMessage.value = pseudo3Error;
            return;
        }
        const client = await createOnlineClient();
        if (await userService.isPseudoUsedLocally(usernameString.value)) {
            // A deleted player of MAUI-API comes back with their PIN; never through createPlayer(),
            // which would hand their scores to whoever takes initials freed upstream.
            if (client && await userService.isDeletedOnlinePlayer(usernameString.value)) {
                returning.value = true;
                apply({kind: 'pin_required'});
            } else {
                errorMessage.value = 'Player name already used';
            }
            return;
        }
        returning.value = false;
        if (!client) {
            const {created} = await userService.registerUser(usernameString.value);
            if (created) {
                step.value = 'success';
            } else {
                errorMessage.value = 'Player name already used';
            }
            return;
        }
        apply(await registerOnline(client, usernameString.value, saveOnlineUser));
    }

    async function submitPin() {
        const client = await createOnlineClient();
        if (!client) {
            errorMessage.value = 'ONLINE is off: the PIN cannot be checked.';
            return;
        }
        apply(await linkWithPin(client, usernameString.value, pin.value.join(''), saveOnlineUser));
    }

    async function validate() {
        if (loading.value || pristine.value) {
            return;
        }
        if (step.value === 'pin_shown') {
            successMessage.value = 'Player created';
            step.value = 'success';
            return;
        }
        if (step.value === 'success') {
            return;
        }
        errorMessage.value = '';
        loading.value = true;
        try {
            await (step.value === 'pin' ? submitPin() : addUser());
        } catch (error) {
            errorMessage.value = error instanceof Error ? error.message : String(error);
        } finally {
            loading.value = false;
        }
    }

    const {onKeydown, onKeyup} = useControllable();

    onKeydown((e, isGamepad) => {
        const key = isGamepad ? (e as CustomEvent).detail.key : (e as KeyboardEvent).code;
        switch (key) {
        case MAUI_KEYS.up:
            changeCharacter(-1);
            break;
        case MAUI_KEYS.down:
            changeCharacter(1);
            break;
        case MAUI_KEYS.left:
            moveSelection(-1);
            break;
        case MAUI_KEYS.right:
            moveSelection(1);
            break;
        case MAUI_KEYS.p:
            void validate();
            break;
        case MAUI_KEYS.space:
            // The PIN must have been seen: no leaving its screen by the cancel button.
            if (step.value !== 'pin_shown') {
                emit('quit');
            }
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

        .letters.pin {
            width: 50%;
        }
            .letters.pin > div {
                width: 25%;
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
