<template>
    <div class="message-curtain" :class="{still: lite}" @animationend.self="land">
        <div class="message-band" :class="[current ? 'kind-' + current.kind : '', {static: lite}]" ref="band">
            <!-- One element per pass (key): its animation starts again, also for a single message. -->
            <!-- .self: the blinking of the text inside ends several times before the message has left. -->
            <div class="message" :class="{scrolling: !lite && duration > 0 && !stops, stopping: !lite && duration > 0 && stops}"
                 v-if="current && landed" :key="pass" ref="track" :style="trackStyle" @animationend.self="next">
                <span class="text">
                    <template v-for="(segment, index) in segments" :key="index">
                        <strong v-if="segment.strong">{{segment.text}}</strong><span v-else>{{segment.text}}</span>
                    </template>
                </span>
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
import {computed, nextTick, onMounted, onUnmounted, ref, watch} from 'vue';
import {parseMessage, type BandMessage} from '@/class/CabinetMessages';
import {isLite} from '@/services';

// The messages of an idle cabinet. A dark, see-through curtain drops over the whole screen and
// bounces as it lands; the messages then cross its middle one at a time, each coming in from the
// right and leaving on the left. A system message, which is short, stops in the middle on its way
// and blinks a few times there; one too long to stand in the band scrolls through like the others. In Lite mode nothing moves (an endless
// animation keeps a software compositor drawing): each message stands still for a while.
const props = defineProps<{messages: BandMessage[]}>();
// Each message as it comes on: the front can follow it (the game it is about).
const emit = defineEmits<{show: [message: BandMessage]}>();

// Part of the screen's width a message crosses in a second, and how long a still one stays.
const SCREEN_WIDTHS_PER_SECOND = 0.14;
const STATIC_MESSAGE_MS = 6000;

const lite = isLite();
const index = ref(0);
// Counts the messages shown: the key of the one on screen.
const pass = ref(0);
const band = ref<HTMLElement | null>(null);
const track = ref<HTMLElement | null>(null);
// Unknown until the message is laid out: it stays hidden meanwhile.
const duration = ref(0);
// The message on screen stops in the middle (a system message that fits) instead of scrolling through.
const stops = ref(false);
// A stopping message: time to come in, stand and leave, whatever its length.
const STOPPING_MESSAGE_S = 7;
let staticTimer: number | undefined;
// The curtain has finished dropping: no message comes on before that (at once in Lite mode,
// where it does not drop).
const landed = ref(lite);

function land() {
    if (!landed.value) {
        landed.value = true;
        void show();
    }
}

const current = computed(() => props.messages.length ? props.messages[index.value % props.messages.length] : null);
const segments = computed(() => current.value ? parseMessage(current.value.text) : []);
// Only the duration is set from here: the animation itself is named in the stylesheet, where
// Vue renames the keyframes of a scoped style (an inline `animation` would not find them).
const trackStyle = computed(() => lite ? {} : duration.value
    ? {'--message-band-duration': `${duration.value}s`}
    : {visibility: 'hidden' as const});

// The messages shown once (an update notice) that have been: skipped from then on, unless
// nothing else is left.
const shownOnce = new Set<string>();
function next() {
    const count = props.messages.length;
    let step = 1;
    while (step < count && isSpent(props.messages[(index.value + step) % count])) {
        step++;
    }
    index.value = count ? (index.value + step) % count : 0;
    pass.value++;
    void show();
}
function isSpent(message: BandMessage): boolean {
    return !!message.once && shownOnce.has(message.id);
}

// Same speed whatever the length: the time comes from the distance, the band plus the message.
async function show() {
    clearTimeout(staticTimer);
    if (!landed.value) {
        return;
    }
    if (current.value) {
        if (current.value.once) {
            shownOnce.add(current.value.id);
        }
        emit('show', current.value);
    }
    if (lite) {
        staticTimer = window.setTimeout(next, STATIC_MESSAGE_MS);
        return;
    }
    duration.value = 0;
    await nextTick();
    if (!band.value || !track.value) {
        return;
    }
    const width = band.value.clientWidth;
    stops.value = current.value?.kind === 'system' && track.value.scrollWidth <= width * 0.9;
    duration.value = stops.value
        ? STOPPING_MESSAGE_S
        : Math.max(1, (width + track.value.scrollWidth) / (width * SCREEN_WIDTHS_PER_SECOND));
}

// A new list starts from its first message, but for one shown once already.
watch(() => props.messages.map(message => message.id).join('\n'), () => {
    const first = props.messages.findIndex(message => !isSpent(message));
    index.value = Math.max(first, 0);
    pass.value++;
    void show();
});
onMounted(() => void show());
onUnmounted(() => clearTimeout(staticTimer));
</script>

<style scoped>
    .message-curtain {
        position: absolute;
        inset: 0;
        /* Above the titles and the hiscores (3), below the long-press loader (6) and the modals (9). */
        z-index: 5;
        background: rgba(0, 0, 0, 0.6);
        /* Runs once: it falls from above the screen, its lower edge bouncing twice. */
        animation: message-curtain-drop 1.1s 1 both;
    }
    /* Lite mode: the curtain is simply there. */
    .message-curtain.still {
        animation: none;
    }
    @keyframes message-curtain-drop {
        0% { transform: translateY(-100%); animation-timing-function: ease-in; }
        50% { transform: translateY(0); animation-timing-function: ease-out; }
        66% { transform: translateY(-9%); animation-timing-function: ease-in; }
        80% { transform: translateY(0); animation-timing-function: ease-out; }
        90% { transform: translateY(-3%); animation-timing-function: ease-in; }
        100% { transform: translateY(0); }
    }
    .message-band {
        position: absolute;
        left: 0;
        right: 0;
        top: 50%;
        height: 12vh;
        margin-top: -6vh;
        overflow: hidden;
        /* A little darker than the curtain around it (0.6 + 0.25 of what is left: 0.7). */
        background: rgba(0, 0, 0, 0.25);
        border-top: 2px solid rgba(255, 245, 19, 0.7);
        border-bottom: 2px solid rgba(255, 245, 19, 0.7);
        color: #ffffff;
        font-family: 'Arcade_I', sans-serif;
        font-size: 2.2vw;
        line-height: 12vh;
        /* Solid, not blurred: nothing here for Lite mode to replace. */
        text-shadow: 0 3px 0 #000000;
    }
    .message-band.kind-system {
        border-color: rgba(63, 210, 255, 0.8);
    }
    .message {
        position: absolute;
        left: 0;
        top: 0;
        white-space: nowrap;
        will-change: transform;
    }
    .message.scrolling {
        animation: message-band-scroll var(--message-band-duration) linear 1 both;
    }
    /* In from the right, a stop in the middle of the screen, out on the left. */
    .message.stopping {
        left: 50%;
        animation: message-band-stop var(--message-band-duration) 1 both;
    }
    /* Starts as the message stops, a few times, then the text stands still. */
    .message.stopping .text {
        animation: message-band-blink 0.45s steps(1, end) 1.1s 4;
    }
    @keyframes message-band-stop {
        0% { transform: translateX(50vw); animation-timing-function: ease-out; }
        15% { transform: translateX(-50%); }
        88% { transform: translateX(-50%); animation-timing-function: ease-in; }
        100% { transform: translateX(calc(-50vw - 100%)); }
    }
    @keyframes message-band-blink {
        0% { opacity: 0; }
        50% { opacity: 1; }
    }
    .message strong {
        font-weight: normal;
        color: #fff513;
    }
    .message-band.kind-system .message strong {
        color: #3fd2ff;
    }
    @keyframes message-band-scroll {
        from { transform: translateX(100vw); }
        to { transform: translateX(-100%); }
    }
    /* Lite mode: the message stands still, centered, on two lines at most. */
    .message-band.static {
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 0 4vw;
        line-height: 1.4;
    }
    .message-band.static .message {
        position: static;
        white-space: normal;
        text-align: center;
        display: -webkit-box;
        -webkit-box-orient: vertical;
        -webkit-line-clamp: 2;
        overflow: hidden;
    }
</style>
