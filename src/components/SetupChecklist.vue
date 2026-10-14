<template>
    <div class="setup-checklist">
        <h1>Set up this cabinet</h1>
        <p class="where">From a phone or a computer on the same network, open
            <a href="#" @click.prevent="openBo">{{boUrl}}</a></p>
        <ol v-if="progress">
            <li v-for="(step, index) in progress.steps" :key="step.id" :class="step.state">
                <span class="mark" aria-hidden="true">{{mark(step.state, index)}}</span>
                <span class="title">{{titles[step.id]}}</span>
                <span class="state">{{STATE_LABELS[step.state]}}</span>
            </li>
        </ol>
        <p v-if="progress" class="count">{{progress.completed}} / {{progress.total}}</p>
    </div>
</template>

<script setup lang="ts">
// The setup guide's steps on the cabinet's own screen (Lot VI.3), while there is nothing else to
// show: no configuration yet (Config.vue), then no game (Home.vue). They are done from the BO's
// "Getting started" page, on another screen: this list follows them.
import * as remote from '@electron/remote';
import {SETUP_STEP_TITLES, type SetupStepState} from '@/class/SetupSteps';
import {useBoUrl} from '@/composables/useBoUrl';
import type {SetupProgress} from '@/class/SetupSteps';

defineProps<{progress: SetupProgress | null}>();

const boUrl = useBoUrl();
const titles = SETUP_STEP_TITLES;

const STATE_LABELS: Record<SetupStepState, string> = {
    done: 'Done',
    current: 'Now',
    todo: '',
    blocked: '',
    manual: 'By hand',
};

// In the system's browser, when the BO is opened on this machine itself.
function openBo(): void {
    remote.shell.openExternal(boUrl.value);
}

function mark(state: SetupStepState, index: number): string {
    return state === 'done' ? '✓' : state === 'current' ? '▶' : String(index + 1);
}
</script>

<style scoped>
    .setup-checklist {
        display: flex;
        flex-direction: column;
        align-items: center;
        text-align: center;
        color: #ffffff;
    }
    h1 {
        margin: 0 0 0.4em;
        color: #fff513;
        font-family: 'Arcade_I', sans-serif;
        font-size: 1.6em;
        text-shadow: 0 3px 0 rgb(255, 81, 0), 0 6px 0 #000000;
    }
    .where {
        margin: 0 0 1em;
    }
    .where a {
        color: #fff513;
        font-weight: bold;
        overflow-wrap: anywhere;
    }
    ol {
        list-style: none;
        margin: 0;
        padding: 0;
        min-width: 60%;
        text-align: left;
    }
    li {
        display: flex;
        align-items: center;
        gap: 0.7em;
        padding: 0.25em 0.6em;
        border-radius: 0.3em;
        color: #8a8a8a;
    }
    .mark {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 1.5em;
        height: 1.5em;
        border-radius: 50%;
        border: 2px solid currentColor;
        font-size: 0.85em;
        flex-shrink: 0;
    }
    .title {
        flex: 1;
    }
    .state {
        font-size: 0.8em;
    }
    li.done {
        color: #6bff8a;
    }
    li.current {
        color: #000000;
        background-color: #fff513;
        /* Home.vue's "no games" screen shadows its text, which blurs black on yellow. */
        text-shadow: none;
    }
    li.todo {
        color: #ffffff;
    }
    li.manual {
        color: #ffd166;
    }
    .count {
        margin: 0.8em 0 0;
        font-size: 0.8em;
        color: #aaaaaa;
    }
</style>
