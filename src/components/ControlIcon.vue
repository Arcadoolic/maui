<template>
    <img class="control-icon" :src="ICONS[action]" alt="">
</template>

<script setup lang="ts">
// The icon of one of MAUI's keys in the front's prompts ("Press ... to validate"): the same
// drawings as the BO's Controls tab (src/assets/input-icons, MAUI_ACTIONS in boServer.ts), so that
// a key looks the same where it is set and where it is asked for.
import confirmIcon from '@/assets/input-icons/confirm.svg';
import scoresIcon from '@/assets/input-icons/scores.svg';
import newPlayerIcon from '@/assets/input-icons/new_player.svg';

export type ControlAction = 'confirm' | 'scores' | 'new_player';

const ICONS: Record<ControlAction, string> = {
    confirm: confirmIcon,
    scores: scoresIcon,
    new_player: newPlayerIcon,
};

defineProps<{action: ControlAction}>();
</script>

<style scoped>
    .control-icon {
        display: inline-block;
        width: 40px;
        height: 40px;
        margin: 0 12px;
        vertical-align: middle;
    }
</style>
